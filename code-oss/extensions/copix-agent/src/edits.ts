export type EditKind = 'write' | 'edit' | 'append' | 'delete';

export interface PendingEdit {
	id: string;
	path: string;
	before: string;
	after: string;
	kind: EditKind;
}

/** In-memory file overlay. Nothing touches disk until Accept. */
export class EditSession {
	private pending = new Map<string, PendingEdit>();

	read(path: string, disk: string | undefined): string {
		const hit = this.pending.get(path);
		if (hit) {
			if (hit.kind === 'delete') {
				throw new Error(`Proposed deletion of ${path} is waiting for Accept or Reject`);
			}
			return hit.after;
		}
		if (disk === undefined) throw new Error(`File not found: ${path}`);
		return disk;
	}

	propose(edit: PendingEdit): PendingEdit {
		this.pending.set(edit.path, edit);
		return edit;
	}

	get(path: string): PendingEdit | undefined {
		return this.pending.get(path);
	}

	all(): PendingEdit[] {
		return [...this.pending.values()];
	}

	accept(path: string): PendingEdit | undefined {
		const edit = this.pending.get(path);
		if (!edit) return undefined;
		this.pending.delete(path);
		return edit;
	}

	reject(path: string): PendingEdit | undefined {
		const edit = this.pending.get(path);
		if (!edit) return undefined;
		this.pending.delete(path);
		return edit;
	}
}

let sequence = 0;

export function nextEditId(): string {
	sequence += 1;
	return `edit-${Date.now()}-${sequence}`;
}
