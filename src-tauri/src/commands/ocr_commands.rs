//! OCR 文字识别：capability = "ocr" 的服务型插件之上的一层薄壳。
//!
//! 把扫描版 PDF 变成「双层可搜索 PDF」——保留原扫描页面，在其下叠加一层隐藏文本，
//! 于是能搜索、能选中复制，版式不变。
//!
//! 插件（Umi-OCR）是常驻 HTTP 服务：进程的拉起/就绪/关闭由 `plugins::service` 按清单接管，
//! 这里只实现它的接口流程——上传 → 轮询 → 取双层 PDF。全程本地，文件不出网。

use serde::Deserialize;
use std::path::Path;

use crate::commands::bookshelf_commands::ensure_within_download_root;
use crate::plugins::{self, installer, manifest::PluginManifest, runner, service};

const CAPABILITY: &str = "ocr";
/// Umi-OCR 成功码
const OK: i64 = 100;

#[derive(Debug, Deserialize)]
struct UploadResp {
    code: i64,
    data: String,
}

#[derive(Debug, Deserialize)]
struct ResultResp {
    code: i64,
    #[serde(default)]
    data: serde_json::Value,
    #[serde(default)]
    is_done: bool,
    #[serde(default)]
    state: String,
    #[serde(default)]
    processed_count: u64,
    #[serde(default)]
    pages_count: u64,
}

#[derive(Debug, Deserialize)]
struct DownloadResp {
    code: i64,
    #[serde(default)]
    data: String,
}

fn ocr_plugin() -> Option<PluginManifest> {
    plugins::all()
        .into_iter()
        .find(|p| p.capability == CAPABILITY)
}

/// OCR 引擎是否就绪（插件已安装即可，服务按需拉起）
#[tauri::command]
pub async fn ocr_available() -> Result<bool, String> {
    Ok(ocr_plugin()
        .map(|p| installer::engine_path(&p).is_some())
        .unwrap_or(false))
}

/// 对一个 PDF 做 OCR，产出双层可搜索 PDF。返回任务 id，进度经 get_plugin_tasks 轮询。
#[tauri::command]
pub async fn ocr_document(
    app_handle: tauri::AppHandle,
    input_path: String,
) -> Result<String, String> {
    let plugin = ocr_plugin().ok_or("没有可用的 OCR 插件")?;
    if installer::engine_path(&plugin).is_none() {
        return Err("OCR 引擎未安装，请先在「插件」页安装".to_string());
    }

    let canonical = ensure_within_download_root(Path::new(&input_path))?;
    let input = runner::simplify_path(canonical.clone());
    if !input.is_file() {
        return Err("文件不存在".to_string());
    }

    let ext = input
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if !plugin.inputs.iter().any(|i| i == &ext) {
        return Err(format!("OCR 不支持的文件类型: {}", ext));
    }

    let registry_path = canonical.to_string_lossy().to_string();
    if runner::is_running(&registry_path) {
        return Err("该文件正在处理中".to_string());
    }

    // 输出：同目录，文件名加「-OCR」后缀，避免覆盖原扫描件
    let output = runner::unique_output_path(&input, "-OCR", "pdf");

    let task_id = runner::create_task(
        &plugin.id,
        &input,
        registry_path,
        &output,
        "pdf".to_string(),
    );

    let id = task_id.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = run_ocr(&app_handle, &plugin, &input, &output, &id).await {
            let _ = std::fs::remove_file(&output); // 清理半成品
            runner::mark_failed(&app_handle, &id, e);
        }
    });

    Ok(task_id)
}

async fn run_ocr(
    app: &tauri::AppHandle,
    plugin: &PluginManifest,
    input: &Path,
    output: &Path,
    task_id: &str,
) -> Result<(), String> {
    // 服务按需启动（首次会慢一些），之后的任务复用同一进程
    let base = service::ensure_running(plugin).await?;
    let client = reqwest::Client::new();

    // 1. 上传文档。mixed = 有文本层的页直接提取、扫描页才走 OCR，又快又准
    let bytes = tokio::fs::read(input)
        .await
        .map_err(|e| format!("读取文件失败: {}", e))?;
    let file_name = input
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "input.pdf".to_string());

    let form = reqwest::multipart::Form::new()
        .text("json", r#"{"doc.extractionMode":"mixed"}"#)
        .part(
            "file",
            reqwest::multipart::Part::bytes(bytes).file_name(file_name),
        );

    let upload: UploadResp = client
        .post(format!("{}/api/doc/upload", base))
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("上传失败: {}", e))?
        .json()
        .await
        .map_err(|e| format!("上传响应异常: {}", e))?;
    if upload.code != OK {
        return Err(format!("上传被拒绝: {}", upload.data));
    }
    let doc_id = upload.data;

    // 2. 轮询直到识别完成；页数进度直接喂给任务表
    let mut done = false;
    for _ in 0..3600 {
        tokio::time::sleep(std::time::Duration::from_millis(800)).await;

        let res: ResultResp = client
            .post(format!("{}/api/doc/result", base))
            .json(&serde_json::json!({ "id": doc_id, "is_data": false, "format": "dict" }))
            .send()
            .await
            .map_err(|e| format!("查询进度失败: {}", e))?
            .json()
            .await
            .map_err(|e| format!("进度响应异常: {}", e))?;

        if res.code != OK {
            let _ = cleanup(&client, &base, &doc_id).await;
            return Err(format!("识别失败: {}", res.data));
        }
        if res.pages_count > 0 {
            let pct = res.processed_count as f64 / res.pages_count as f64 * 100.0;
            // 留一点余量给「生成 PDF」这一步，别让进度条提前满格
            runner::set_progress(task_id, pct * 0.9);
        }
        if res.is_done {
            if res.state != "success" {
                let _ = cleanup(&client, &base, &doc_id).await;
                return Err(format!("识别未成功（状态 {}）", res.state));
            }
            done = true;
            break;
        }
    }
    if !done {
        let _ = cleanup(&client, &base, &doc_id).await;
        return Err("识别超时".to_string());
    }

    // 3. 生成双层可搜索 PDF 的下载链接
    let dl: DownloadResp = client
        .post(format!("{}/api/doc/download", base))
        .json(&serde_json::json!({
            "id": doc_id,
            "file_types": ["pdfLayered"],
            "ignore_blank": true
        }))
        .send()
        .await
        .map_err(|e| format!("生成结果失败: {}", e))?
        .json()
        .await
        .map_err(|e| format!("结果响应异常: {}", e))?;
    if dl.code != OK || dl.data.is_empty() {
        let _ = cleanup(&client, &base, &doc_id).await;
        return Err("生成双层 PDF 失败".to_string());
    }

    // 4. 取回文件。注意：接口返回的是**绝对 URL**（文档里写的是相对路径，实测不是），
    //    直接拼 base 会得到 http://...http://... 这种废 URL，所以按前缀判断。
    let file_url = if dl.data.starts_with("http://") || dl.data.starts_with("https://") {
        dl.data.clone()
    } else {
        format!("{}{}", base, dl.data)
    };
    let file = client
        .get(&file_url)
        .send()
        .await
        .map_err(|e| format!("下载结果失败: {}", e))?
        .bytes()
        .await
        .map_err(|e| format!("读取结果失败: {}", e))?;

    if file.is_empty() {
        let _ = cleanup(&client, &base, &doc_id).await;
        return Err("生成的 PDF 是空的".to_string());
    }
    tokio::fs::write(output, &file)
        .await
        .map_err(|e| format!("保存结果失败: {}", e))?;

    // 5. 清掉服务端的临时文件（失败也无所谓，不影响用户拿到结果）
    let _ = cleanup(&client, &base, &doc_id).await;

    runner::mark_success(app, task_id, output);
    Ok(())
}

async fn cleanup(client: &reqwest::Client, base: &str, doc_id: &str) -> Result<(), String> {
    client
        .get(format!("{}/api/doc/clear/{}", base, doc_id))
        .send()
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}
