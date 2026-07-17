#!/usr/bin/env node

/**
 * 一键更新版本号工具
 * 
 * 用法:
 *   node tools/bump-version.mjs <新版本号>
 *   node tools/bump-version.mjs 3.2.0
 *   node tools/bump-version.mjs patch    // 3.1.0 → 3.1.1
 *   node tools/bump-version.mjs minor    // 3.1.0 → 3.2.0
 *   node tools/bump-version.mjs major    // 3.1.0 → 4.0.0
 * 
 * 会同步更新以下位置的版本号:
 *   1. package.json                            - 前端包版本
 *   2. src-tauri/tauri.conf.json               - Tauri 应用版本
 *   3. src-tauri/Cargo.toml                     - Rust crate 版本
 *   4. src/pages/SettingsPage/AboutSection.tsx  - 关于页面 UI 显示版本
 *   5. src/components/Sidebar.tsx               - 侧边栏 UI 显示版本
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

// ─── 颜色输出工具 ────────────────────────────────────────────────
const c = {
  green:   (s) => `\x1b[32m${s}\x1b[0m`,
  red:     (s) => `\x1b[31m${s}\x1b[0m`,
  yellow:  (s) => `\x1b[33m${s}\x1b[0m`,
  cyan:    (s) => `\x1b[36m${s}\x1b[0m`,
  bold:    (s) => `\x1b[1m${s}\x1b[0m`,
  dim:     (s) => `\x1b[2m${s}\x1b[0m`,
};

// ─── 读取当前版本号（以 package.json 为准） ──────────────────────
function getCurrentVersion() {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'));
  return pkg.version;
}

// ─── 解析语义化版本号 ───────────────────────────────────────────
function parseSemver(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

// ─── 计算新版本号 ───────────────────────────────────────────────
function resolveNewVersion(input, currentVersion) {
  // 如果是 major / minor / patch 关键字
  const bumpTypes = ['major', 'minor', 'patch'];
  if (bumpTypes.includes(input)) {
    const parsed = parseSemver(currentVersion);
    if (!parsed) {
      console.error(c.red(`✗ 当前版本号格式无效: ${currentVersion}`));
      process.exit(1);
    }
    switch (input) {
      case 'major':
        return `${parsed.major + 1}.0.0`;
      case 'minor':
        return `${parsed.major}.${parsed.minor + 1}.0`;
      case 'patch':
        return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
    }
  }

  // 直接指定版本号
  if (/^\d+\.\d+\.\d+$/.test(input)) {
    return input;
  }

  console.error(c.red(`✗ 无效的版本号参数: "${input}"`));
  console.error(c.dim('  用法: node tools/bump-version.mjs <版本号|major|minor|patch>'));
  console.error(c.dim('  示例: node tools/bump-version.mjs 3.2.0'));
  console.error(c.dim('        node tools/bump-version.mjs patch'));
  process.exit(1);
}

// ─── 文件更新函数 ───────────────────────────────────────────────

/**
 * 更新 JSON 文件中的 version 字段
 */
function updateJsonFile(filePath, newVersion) {
  const relPath = filePath.replace(ROOT + '\\', '').replace(ROOT + '/', '');
  const content = readFileSync(filePath, 'utf-8');
  const json = JSON.parse(content);
  const oldVersion = json.version;

  if (oldVersion === newVersion) {
    console.log(c.dim(`  ─ ${relPath} (已经是 ${newVersion}，跳过)`));
    return { updated: false, oldVersion };
  }

  json.version = newVersion;
  // 保持原有缩进格式
  const indent = content.match(/^(\s+)/m)?.[1] || '  ';
  writeFileSync(filePath, JSON.stringify(json, null, indent.length) + '\n', 'utf-8');
  console.log(c.green(`  ✓ ${relPath}`) + c.dim(` ${oldVersion} → `) + c.cyan(newVersion));
  return { updated: true, oldVersion };
}

/**
 * 更新 Cargo.toml 中的 version
 */
function updateCargoToml(filePath, newVersion) {
  const relPath = filePath.replace(ROOT + '\\', '').replace(ROOT + '/', '');
  let content = readFileSync(filePath, 'utf-8');

  const versionRegex = /^(version\s*=\s*")([^"]+)(")/m;
  const match = content.match(versionRegex);
  if (!match) {
    console.error(c.red(`  ✗ ${relPath} 中未找到 version 字段`));
    return { updated: false };
  }

  const oldVersion = match[2];
  if (oldVersion === newVersion) {
    console.log(c.dim(`  ─ ${relPath} (已经是 ${newVersion}，跳过)`));
    return { updated: false, oldVersion };
  }

  content = content.replace(versionRegex, `$1${newVersion}$3`);
  writeFileSync(filePath, content, 'utf-8');
  console.log(c.green(`  ✓ ${relPath}`) + c.dim(` ${oldVersion} → `) + c.cyan(newVersion));
  return { updated: true, oldVersion };
}

/**
 * 更新 TSX/TS 文件中的硬编码版本号
 */
function updateTsxVersion(filePath, pattern, replacement, newVersion) {
  const relPath = filePath.replace(ROOT + '\\', '').replace(ROOT + '/', '');
  let content = readFileSync(filePath, 'utf-8');

  if (!pattern.test(content)) {
    console.error(c.red(`  ✗ ${relPath} 中未找到版本号模式`));
    return { updated: false };
  }

  const oldMatch = content.match(pattern);
  const oldText = oldMatch ? oldMatch[0] : '?';

  content = content.replace(pattern, replacement(newVersion));
  writeFileSync(filePath, content, 'utf-8');
  console.log(c.green(`  ✓ ${relPath}`) + c.dim(` "${oldText.trim()}" → `) + c.cyan(replacement(newVersion).trim()));
  return { updated: true };
}

// ─── 主流程 ────────────────────────────────────────────────────
function main() {
  const input = process.argv[2];

  if (!input || input === '--help' || input === '-h') {
    console.log(`
${c.bold('📦 Olib 版本号一键更新工具')}

${c.yellow('用法:')}
  node tools/bump-version.mjs <版本号>     直接指定版本号
  node tools/bump-version.mjs patch        补丁版本 +1
  node tools/bump-version.mjs minor        次版本号 +1
  node tools/bump-version.mjs major        主版本号 +1

${c.yellow('更新范围:')}
  1. package.json                            前端包版本
  2. src-tauri/tauri.conf.json               Tauri 应用版本
  3. src-tauri/Cargo.toml                     Rust crate 版本
  4. src/pages/SettingsPage/AboutSection.tsx  关于页面显示版本
  5. src/components/Sidebar.tsx               侧边栏显示版本

${c.yellow('示例:')}
  node tools/bump-version.mjs 3.2.0
  node tools/bump-version.mjs patch
`);
    process.exit(0);
  }

  const currentVersion = getCurrentVersion();
  const newVersion = resolveNewVersion(input, currentVersion);

  console.log('');
  console.log(c.bold(`📦 更新版本号: ${c.yellow(currentVersion)} → ${c.cyan(newVersion)}`));
  console.log(c.dim('─'.repeat(50)));

  let updatedCount = 0;

  // 1. package.json
  const r1 = updateJsonFile(resolve(ROOT, 'package.json'), newVersion);
  if (r1.updated) updatedCount++;

  // 2. tauri.conf.json
  const r2 = updateJsonFile(resolve(ROOT, 'src-tauri', 'tauri.conf.json'), newVersion);
  if (r2.updated) updatedCount++;

  // 3. Cargo.toml
  const r3 = updateCargoToml(resolve(ROOT, 'src-tauri', 'Cargo.toml'), newVersion);
  if (r3.updated) updatedCount++;

  // 4. AboutSection.tsx - 格式为 "v3.1.0"
  const r4 = updateTsxVersion(
    resolve(ROOT, 'src', 'pages', 'SettingsPage', 'AboutSection.tsx'),
    /v\d+\.\d+\.\d+/,
    (v) => `v${v}`,
    newVersion
  );
  if (r4.updated) updatedCount++;

  // 5. Sidebar.tsx - 格式为 "Version x.x.x"
  const r5 = updateTsxVersion(
    resolve(ROOT, 'src', 'components', 'Sidebar.tsx'),
    /Version \d+\.\d+\.\d+/,
    (v) => `Version ${v}`,
    newVersion
  );
  if (r5.updated) updatedCount++;

  console.log(c.dim('─'.repeat(50)));

  if (updatedCount === 0) {
    console.log(c.yellow(`⚡ 所有文件已经是 v${newVersion}，无需更新`));
  } else {
    console.log(c.green(c.bold(`✅ 完成! 共更新 ${updatedCount} 个文件`)));
    console.log('');
    console.log(c.dim('提示: 记得运行以下命令确认更新:'));
    console.log(c.dim('  git diff'));
    console.log(c.dim('  git add -A && git commit -m "chore: bump version to ' + newVersion + '"'));
  }
  console.log('');
}

main();
