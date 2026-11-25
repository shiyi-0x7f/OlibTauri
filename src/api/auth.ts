import { invoke } from "./core";
import { invalidateConfigCache } from "./config";

export interface User {
  email: string;
  password: string;
  name: string | null;
  remix_user_id: string | null;
  remix_user_key: string | null;
  downloads_today: number;
  downloads_limit: number;
}

export interface LoginResult {
  success: boolean;
  message: string;
  user_name: string | null;
}

export async function login(email: string, password: string): Promise<LoginResult> {
  const result = await invoke<LoginResult>("login", { email, password });
  invalidateConfigCache(); // 后端写 user_email / host_index
  return result;
}

export function getAllUsers(): Promise<User[]> {
  return invoke("get_all_users");
}

export function deleteUser(email: string): Promise<void> {
  return invoke("delete_user", { email });
}

export function getCurrentUser(): Promise<User | null> {
  return invoke("get_current_user");
}

export async function switchUser(email: string): Promise<LoginResult> {
  const result = await invoke<LoginResult>("switch_user", { email });
  invalidateConfigCache(); // 后端写 user_email
  return result;
}

export async function logout(): Promise<void> {
  await invoke("logout");
  invalidateConfigCache(); // 后端清空 user_email
}

/** 刷新当前用户的下载配额；未登录返回 null，刷新失败返回库中旧值 */
export function refreshUserDownloads(): Promise<User | null> {
  return invoke("refresh_user_downloads");
}
