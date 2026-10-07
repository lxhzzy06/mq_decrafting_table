/**
 * 发布队列的筛选逻辑。
 *
 * 单独成模块是因为这里出过事故: 只取上游 listReleases()[0] 会让正式版被同期 preview 永久挤掉
 * (v1.26.40.5 甚至根本没有 release 对象), 而这套判断跟 GitHub 网络无关, 可以完全离线测。
 */

/// 上游 tag 形如 v1.26.50.4 / v1.26.60.29-preview
export const TAG_RE = /^v(\d+)\.(\d+)\.(\d+)\.(\d+)(-preview)?$/;

/** @returns {number[]|null} 四段版本号, 非法 tag 返回 null */
export function versionKey(tag) {
	const m = TAG_RE.exec(tag);
	return m ? [+m[1], +m[2], +m[3], +m[4]] : null;
}

/** 版本系列, 例如 "1.26.50" */
export function seriesOf(tag) {
	const k = versionKey(tag);
	return k ? `${k[0]}.${k[1]}.${k[2]}` : null;
}

function compareKeys(a, b) {
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return a[i] - b[i];
	}
	return 0;
}

/**
 * 从候选版本里挑出本轮要发布的。
 *
 * @param {Array<{tag: string}>} candidates 上游 tag ∪ release 对象, 由调用方合并
 * @param {{published?: string[], series?: number, maxPerRun?: number}} options
 * @returns {{queue: any[], missing: number, deferred: number}}
 */
export function selectQueue(candidates, { published = [], series = 3, maxPerRun = 4 } = {}) {
	const done = new Set(published);
	const missing = candidates
		.filter((c) => versionKey(c.tag) && !done.has(c.tag))
		.sort((a, b) => compareKeys(versionKey(a.tag), versionKey(b.tag)));

	// 只保留最新的几个系列, 更早的历史版本不再回补
	const seen = [...new Set(missing.map((c) => seriesOf(c.tag)))].sort(compareKeys).reverse().slice(0, series);
	const keep = new Set(seen);

	const queue = missing.filter((c) => keep.has(seriesOf(c.tag)));
	return {
		queue: queue.slice(0, maxPerRun),
		missing: missing.length,
		deferred: Math.max(queue.length - maxPerRun, 0),
	};
}

/**
 * 判定是否预发布版本。
 *
 * 优先级: 上游 release 对象的标记 > 上游 version.json 里该版本的记录 > 保守默认。
 * 判不出来时按预览版处理: 误判成正式版会把预发布构建推上 CurseForge 的稳定版通道,
 * 而误判成预览版只是少发一次商店更新。上游 tag 名不可靠(如 v1.26.20.26 并不带 -preview 后缀)。
 *
 * @param {{upstreamPrerelease?: boolean, record?: {type?: string}}} input
 */
export function resolvePrerelease({ upstreamPrerelease, record }) {
	if (typeof upstreamPrerelease === 'boolean') return upstreamPrerelease;
	if (record) return record.type === 'preview';
	return true;
}
