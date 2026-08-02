import { useEffect, useMemo, useRef, useState } from 'react';
import type { ModelSettings } from '../types';
import {
	FALLBACK_MODEL_ID,
	GROQ_FALLBACK_MODEL,
	GROQ_MODEL_FALLBACKS,
	GROQ_MODE_MODEL_PREFERENCE,
	MODE_MODEL_PREFERENCE,
	OPENAI_FEATURED_MODELS,
	OPENROUTER_FEATURED_MODELS,
	defaultCloudModel,
	normalizeProvider,
	sanitizeGroqModelId,
} from '../models/modelCatalog';
import { normalizeModelSettings } from '../models/modelSelector';

export type ModelOption = {
	id: string;
	label: string;
	detail?: string;
	badge?: string;
};

type Props = {
	settings: ModelSettings;
	installed?: string[];
	onChange: (next: ModelSettings) => void;
	onClose: () => void;
	className?: string;
};

function uniqueIds(ids: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const raw of ids) {
		const id = raw.trim();
		if (!id || seen.has(id)) continue;
		seen.add(id);
		out.push(id);
	}
	return out;
}

function shortDetail(id: string): string | undefined {
	const lower = id.toLowerCase();
	if (lower.includes('instant') || lower.includes('fast')) return 'Fast';
	if (lower.includes('70b') || lower.includes('versatile') || lower.includes('large')) return 'High';
	if (lower.includes('8b') || lower.includes('3b') || lower.includes('4b')) return 'Medium';
	if (lower.includes('coder')) return 'Code';
	return undefined;
}

function prettyLabel(id: string): string {
	return id
		.replace(/^meta-llama\//, '')
		.replace(/^openai\//, '')
		.replace(/-/g, ' ');
}

export function buildModelOptions(settings: ModelSettings, installed: string[] = []): ModelOption[] {
	const provider = normalizeProvider(settings.provider);
	if (provider === 'openrouter' || provider === 'openai') {
		const featured = provider === 'openrouter' ? OPENROUTER_FEATURED_MODELS : OPENAI_FEATURED_MODELS;
		const options: ModelOption[] = featured.map(m => ({
			id: m.id,
			label: m.label,
			detail: m.detail,
			badge: m.id === defaultCloudModel(provider) ? 'BEST' : undefined,
		}));
		const custom = settings.modelId?.trim();
		if (custom && !options.some(o => o.id === custom)) {
			options.push({ id: custom, label: prettyLabel(custom), detail: 'Custom' });
		}
		return options;
	}
	if (provider === 'groq') {
		const ids = uniqueIds([
			...Object.values(GROQ_MODE_MODEL_PREFERENCE),
			...GROQ_MODEL_FALLBACKS,
			GROQ_FALLBACK_MODEL,
			settings.modelId,
		].map(sanitizeGroqModelId));
		return ids.map(id => ({
			id,
			label: prettyLabel(id),
			detail: shortDetail(id),
			badge: id === 'llama-3.3-70b-versatile' ? 'NEW' : undefined,
		}));
	}

	const preferred = uniqueIds([
		...Object.values(MODE_MODEL_PREFERENCE),
		FALLBACK_MODEL_ID,
		settings.modelId,
		...installed,
	]);
	return preferred.map(id => ({
		id,
		label: prettyLabel(id),
		detail: shortDetail(id) ?? (installed.some(n => n === id || n.startsWith(`${id.split(':')[0]}:`)) ? 'Installed' : 'Pull'),
	}));
}

export function ModelPickerMenu({ settings, installed = [], onChange, onClose, className }: Props) {
	const [query, setQuery] = useState('');
	const rootRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const normalized = normalizeModelSettings(settings);
	const auto = normalized.selection !== 'manual';
	const options = useMemo(() => buildModelOptions(settings, installed), [settings, installed]);
	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return options;
		return options.filter(o =>
			o.id.toLowerCase().includes(q)
			|| o.label.toLowerCase().includes(q)
			|| (o.detail?.toLowerCase().includes(q) ?? false),
		);
	}, [options, query]);

	useEffect(() => {
		inputRef.current?.focus();
		const onDoc = (e: MouseEvent) => {
			if (!rootRef.current?.contains(e.target as Node)) onClose();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
		};
		document.addEventListener('mousedown', onDoc);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('mousedown', onDoc);
			document.removeEventListener('keydown', onKey);
		};
	}, [onClose]);

	const setAuto = (next: boolean) => {
		const provider = normalizeProvider(settings.provider);
		onChange({
			...settings,
			selection: next ? 'auto' : 'manual',
			modelId: settings.modelId
				|| (provider === 'ollama' ? FALLBACK_MODEL_ID : defaultCloudModel(provider)),
		});
	};

	const pickModel = (id: string) => {
		onChange({
			...settings,
			selection: 'manual',
			modelId: normalizeProvider(settings.provider) === 'groq' ? sanitizeGroqModelId(id) : id,
		});
		onClose();
	};

	return (
		<div ref={rootRef} className={`model-picker-menu${className ? ` ${className}` : ''}`}>
			<input
				ref={inputRef}
				className="model-picker-search"
				placeholder="Search models"
				value={query}
				onChange={e => setQuery(e.target.value)}
			/>
			<div className="model-picker-auto-row">
				<span>Auto</span>
				<button
					type="button"
					className={`model-picker-toggle${auto ? ' on' : ''}`}
					role="switch"
					aria-checked={auto}
					title={auto ? 'Auto model selection on' : 'Auto model selection off'}
					onClick={() => setAuto(!auto)}
				>
					<span className="model-picker-toggle-knob" />
				</button>
			</div>
			<div className="model-picker-list">
				{filtered.map(opt => {
					const selected = !auto && normalized.modelId === opt.id;
					return (
						<button
							key={opt.id}
							type="button"
							className={`model-picker-item${selected ? ' selected' : ''}`}
							onClick={() => pickModel(opt.id)}
						>
							<span className="model-picker-item-main">
								<span className="model-picker-item-label">{opt.label}</span>
								{opt.detail && <span className="model-picker-item-detail">{opt.detail}</span>}
								{opt.badge && <span className="model-picker-item-badge">{opt.badge}</span>}
							</span>
							{selected && <span className="model-picker-check">✓</span>}
						</button>
					);
				})}
				{!filtered.length && (
					<div className="model-picker-empty">No models match</div>
				)}
			</div>
		</div>
	);
}
