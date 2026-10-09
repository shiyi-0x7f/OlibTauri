//! LAN 无线传书端到端测试：起服务 → 身份端点 → OPDS feed → 下载 → 上传 → 书单导入
//!
//! 运行：cargo test --test opds_test
//! 依赖本机有可用局域网 IP（lan_server::start 会探测网卡）
//! 契约见 dev_docs/mobile-sync.md 与 olib-mobile lib/services/lan_client.dart

use olib_fluent_lib::{config, database, lan_server};

const TEST_PORT: u16 = 18965;
const TEST_EMAIL: &str = "lan-test@example.com";

#[tokio::test]
async fn lan_server_end_to_end() {
    // 1. 准备临时书库目录与样本文件
    let base = std::env::temp_dir().join(format!("olib-lan-test-{}", std::process::id()));
    let books = base.join("books");
    let _ = std::fs::remove_dir_all(&base);
    std::fs::create_dir_all(&books).unwrap();
    std::fs::write(books.join("三体：黑暗森林.epub"), b"epub-bytes").unwrap();
    std::fs::write(books.join("manual & guide.pdf"), b"pdf-bytes").unwrap();
    std::fs::write(books.join("ignore.xyz"), b"not-a-book").unwrap();

    // 2. 初始化配置/数据库，指向临时书库，模拟已登录用户（书单导入需要）
    config::init_config(&base).unwrap();
    config::update_value(|c| {
        c.download_folder = books.to_string_lossy().to_string();
        c.user_email = TEST_EMAIL.to_string();
    })
    .unwrap();
    database::init_db(&base).unwrap();

    // 3. 启动 LAN 服务
    let status = lan_server::start(TEST_PORT, books.to_string_lossy().to_string())
        .await
        .expect("LAN server should start (requires a LAN IP on this machine)");
    assert!(status.running);
    assert_eq!(status.opds_url, format!("{}/opds", status.url));

    let local = format!("http://127.0.0.1:{}", TEST_PORT);
    let client = reqwest::Client::new();

    // 4. 身份端点：移动端扫码后靠它确认对端是 Olib 桌面端
    let info: serde_json::Value = client
        .get(format!("{}/api/info", local))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(info["app"], "olib-desktop");
    assert_eq!(info["version"], env!("CARGO_PKG_VERSION"));
    assert!(info["device_name"].as_str().is_some_and(|s| !s.is_empty()));
    let caps: Vec<&str> = info["capabilities"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|v| v.as_str())
        .collect();
    for cap in ["files", "opds", "upload", "booklist"] {
        assert!(caps.contains(&cap), "missing capability: {}", cap);
    }

    // 5. 文件列表
    let files: Vec<serde_json::Value> = client
        .get(format!("{}/api/files", local))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(files.len(), 3);

    // 6. 拉取 OPDS feed 并校验
    let resp = client.get(format!("{}/opds", local)).send().await.unwrap();
    assert_eq!(resp.status(), 200);
    let content_type = resp
        .headers()
        .get("content-type")
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();
    assert!(
        content_type.contains("profile=opds-catalog"),
        "content-type should be an OPDS catalog, got: {}",
        content_type
    );
    let feed = resp.text().await.unwrap();

    // 结构：Atom feed + OPDS 命名空间
    assert!(feed.starts_with("<?xml"));
    assert!(feed.contains(r#"xmlns="http://www.w3.org/2005/Atom""#));
    assert!(feed.contains(r#"xmlns:opds="http://opds-spec.org/2010/catalog""#));
    assert!(feed.contains("<title>Olib 书库</title>"));

    // 条目：电子书扩展名收录，标题去扩展名，XML 特殊字符转义
    assert!(feed.contains("<title>三体：黑暗森林</title>"));
    assert!(feed.contains("<title>manual &amp; guide</title>"));
    assert!(
        !feed.contains("ignore"),
        "non-ebook extensions must be excluded"
    );

    // 获取链接：acquisition rel + 正确 MIME + 文件大小
    assert!(feed.contains(r#"rel="http://opds-spec.org/acquisition""#));
    assert!(feed.contains("application/epub+zip"));
    assert!(feed.contains("application/pdf"));
    assert!(feed.contains(r#"length="10""#)); // "epub-bytes" = 10 字节

    // 7. 从 feed 中提取 epub 的 href，走真实下载链路（覆盖中文文件名 percent-encoding）
    let href = feed
        .split("href=\"")
        .filter_map(|s| s.split('"').next())
        .find(|h| h.starts_with("/download/") && h.contains(".epub"))
        .expect("feed should contain an epub download href");
    let dl = client
        .get(format!("{}{}", local, href))
        .send()
        .await
        .unwrap();
    assert_eq!(dl.status(), 200);
    assert_eq!(dl.bytes().await.unwrap().as_ref(), b"epub-bytes");

    // 8. 上传：multipart 字段 file（移动端「发送到电脑」）
    let upload = |name: &str, bytes: &'static [u8]| {
        let form = reqwest::multipart::Form::new().part(
            "file",
            reqwest::multipart::Part::bytes(bytes).file_name(name.to_string()),
        );
        client
            .post(format!("{}/api/upload", local))
            .multipart(form)
            .send()
    };
    let resp = upload("来自手机.epub", b"uploaded").await.unwrap();
    assert_eq!(resp.status(), 201);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["name"], "来自手机.epub");
    assert_eq!(body["size"], 8);
    assert_eq!(
        std::fs::read(books.join("来自手机.epub")).unwrap(),
        b"uploaded"
    );

    // 同名不覆盖，追加 " (n)" 去重
    let resp = upload("来自手机.epub", b"uploaded-2").await.unwrap();
    assert_eq!(resp.status(), 201);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["name"], "来自手机 (1).epub");

    // 白名单外的扩展名拒收，400 带 detail
    let resp = upload("malware.exe", b"nope").await.unwrap();
    assert_eq!(resp.status(), 400);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert!(body["detail"].as_str().is_some_and(|s| !s.is_empty()));
    assert!(!books.join("malware.exe").exists());

    // 9. 书单导入：codec v1 结构（条目短键 t/a/h），按 (book_id, user_email) 去重
    let booklist = serde_json::json!({
        "v": 1,
        "name": "测试书单",
        "books": [
            { "id": "1001", "t": "三体", "a": "刘慈欣", "h": "abc123" },
            { "id": "1002" }
        ]
    });
    let push_booklist = || {
        client
            .post(format!("{}/api/booklist", local))
            .json(&booklist)
            .send()
    };
    let body: serde_json::Value = push_booklist().await.unwrap().json().await.unwrap();
    assert_eq!(body["imported"], 2);
    assert_eq!(body["skipped"], 0);
    // 重复推送全部跳过
    let body: serde_json::Value = push_booklist().await.unwrap().json().await.unwrap();
    assert_eq!(body["imported"], 0);
    assert_eq!(body["skipped"], 2);

    let favs = database::get_favorites(TEST_EMAIL, 1, 10).unwrap();
    assert_eq!(favs.len(), 2);
    let sanben = favs.iter().find(|f| f.book_id == "1001").unwrap();
    assert_eq!(sanben.title, "三体");
    assert_eq!(sanben.author.as_deref(), Some("刘慈欣"));
    assert_eq!(sanben.hash.as_deref(), Some("abc123"));
    // 无元数据的条目以 id 兜底做标题
    assert_eq!(
        favs.iter().find(|f| f.book_id == "1002").unwrap().title,
        "1002"
    );

    // 10. 清理
    lan_server::stop().unwrap();
    let _ = std::fs::remove_dir_all(&base);
}
