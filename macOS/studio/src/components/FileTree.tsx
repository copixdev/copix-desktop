import { useMemo, useState } from 'react';
import { IconFile, IconChevron } from './Icons';

interface Props {
	tree: string[];
	activePath?: string;
	onOpenFile: (path: string) => void;
}

export function FileTree({ tree, activePath, onOpenFile }: Props) {
	const [openDirs, setOpenDirs] = useState<Set<string>>(() => new Set(['']));

	const nodes = useMemo(() => {
		const root: Record<string, { files: string[]; dirs: Set<string> }> = { '': { files: [], dirs: new Set() } };
		for (const p of tree) {
			if (p.endsWith('/')) {
				const dir = p.slice(0, -1);
				const parent = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '';
				if (!root[parent]) root[parent] = { files: [], dirs: new Set() };
				root[parent].dirs.add(dir);
				if (!root[dir]) root[dir] = { files: [], dirs: new Set() };
			} else {
				const parent = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
				if (!root[parent]) root[parent] = { files: [], dirs: new Set() };
				root[parent].files.push(p);
			}
		}
		return root;
	}, [tree]);

	const toggle = (dir: string) => {
		setOpenDirs(prev => {
			const next = new Set(prev);
			if (next.has(dir)) next.delete(dir); else next.add(dir);
			return next;
		});
	};

	const renderDir = (dir: string, depth: number) => {
		const node = nodes[dir];
		if (!node) return null;
		const dirs = [...node.dirs].sort();
		const files = [...node.files].sort();
		return (
			<div key={dir || 'root'}>
				{dir && (
					<button type="button" className="tree-dir" style={{ paddingLeft: 8 + depth * 12 }} onClick={() => toggle(dir)}>
						<IconChevron width={12} height={12} className={openDirs.has(dir) ? 'open' : ''} />
						<span>{dir.split('/').pop()}</span>
					</button>
				)}
				{(dir === '' || openDirs.has(dir)) && (
					<>
						{dirs.map(d => renderDir(d, dir === '' ? depth : depth + 1))}
						{files.map(f => (
							<button
								key={f}
								type="button"
								className={`tree-file${activePath === f ? ' active' : ''}`}
								style={{ paddingLeft: 20 + (dir === '' ? depth : depth + 1) * 12 }}
								onClick={() => onOpenFile(f)}
							>
								<IconFile width={13} height={13} />
								<span>{f.split('/').pop()}</span>
							</button>
						))}
					</>
				)}
			</div>
		);
	};

	if (!tree.length) return <div className="tree-empty">No files yet</div>;
	return <div className="file-tree">{renderDir('', 0)}</div>;
}
