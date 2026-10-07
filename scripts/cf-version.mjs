/**
 * CurseForge 游戏版本匹配。
 *
 * 版本号有两套体系:
 *  - 对外发布: 2026 年起改用年份编号, 例如 26.50 (见 aka.ms/MinecraftVersionUpdate)
 *  - API 与 JSON: 官方明确继续沿用 1.26.xx.yy, 这也是 bedrock-samples 的 tag 格式
 * CurseForge 的版本清单随对外编号走, 因此发布时需要同时围绕两种写法生成候选。
 */

/** 由发布的 tag 生成可能的游戏版本名称候选, 按优先级排列 */
export function versionCandidates(tagName) {
	const base = String(tagName ?? '').replace(/^v/i, '');
	const parts = base.split('.');
	const candidates = new Set([base]);

	// 传统命名: 主.次.修订 (1.26.50)
	if (parts.length >= 3) candidates.add(parts.slice(0, 3).join('.'));

	// 年份编号: 去掉开头的 "1." 段 (26.50 / 26.50.4)
	if (parts[0] === '1' && parts.length > 1) {
		const rest = parts.slice(1);
		candidates.add(rest.slice(0, 2).join('.'));
		if (rest.length > 2) candidates.add(rest.join('.'));
	}

	return [...candidates];
}

/**
 * 在 CurseForge 返回的版本列表中找到与目标 tag 匹配的项。
 * 先精确匹配, 再退化为同段前缀匹配。匹配不到时返回 undefined, 由调用方跳过发布。
 */
export function matchGameVersion(tagName, versions) {
	const candidates = versionCandidates(tagName);
	const list = Array.isArray(versions) ? versions : [];

	for (const candidate of candidates) {
		const hit = list.find((version) => version.name === candidate);
		if (hit) return hit;
	}

	return list.find((version) =>
		candidates.some((candidate) => candidate.startsWith(`${version.name}.`) || version.name.startsWith(`${candidate}.`))
	);
}
