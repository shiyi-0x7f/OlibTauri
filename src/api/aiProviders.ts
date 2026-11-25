/**
 * AI 寻书内置服务商预设（OpenAI 兼容接口）。
 *
 * - baseUrl：已对照各家官方文档核实（2026-11）。模型名变动频繁，不在此写死，由设置页调 `/models` 拉取。
 * - signupUrl：注册 / 开通入口。**带推广邀请码的链接只需替换此字段**，其余代码不用动。
 * - 顺序即设置页展示顺序，首项为默认选中：有推广收益的排前面，DeepSeek / OpenAI 为常用官方入口，其余走「自定义」。
 */
export interface AiProvider {
  id: string;
  name: string;
  baseUrl: string;
  /** 注册 / 开通入口（可替换为推广邀请链接） */
  signupUrl: string;
  /** 一句话说明，显示在设置页 */
  hint: string;
}

export const AI_PROVIDERS: AiProvider[] = [
  {
    id: "siliconflow",
    name: "硅基流动",
    baseUrl: "https://api.siliconflow.cn/v1",
    // 推广邀请链接
    signupUrl: "https://cloud.siliconflow.cn/i/6GFVeIOr",
    hint: "聚合多家开源模型，注册实名后在「API 密钥」创建 Key",
  },
  {
    id: "bailian",
    name: "阿里百炼",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    // 阿里云云大使推广链接
    signupUrl:
      "https://www.aliyun.com/minisite/goods?clubTaskBiz=subTask..13026435..10292..&userCode=uyzbu3m2",
    hint: "阿里云百炼（通义千问等），开通后在「API-KEY」页创建",
  },
  {
    id: "zhipu",
    name: "智谱",
    // 按量计费的通用接口；勿用 GLM Coding Plan 套餐 Key（条款禁止在第三方应用中调用）
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    // 智谱开放平台邀请链接（被邀请人注册获赠 Tokens 礼包）
    signupUrl:
      "https://www.bigmodel.cn/invite?icode=cvnvIg56YkndmijcWvnVI3HEaazDlIZGj9HxftzTbt4%3D",
    hint: "智谱 BigModel（GLM 系列），注册后创建「模型标准 API」的 Key；Coding Plan 套餐 Key 不通用",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    signupUrl: "https://platform.deepseek.com/",
    hint: "DeepSeek 开放平台，注册后在「API keys」创建 Key",
  },
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    signupUrl: "https://platform.openai.com/",
    hint: "OpenAI 官方（ChatGPT 同源模型），在「API keys」创建 Key；国内网络通常需代理",
  },
];

export const CUSTOM_PROVIDER_ID = "custom";

export function findProvider(id: string): AiProvider | undefined {
  return AI_PROVIDERS.find((p) => p.id === id);
}
