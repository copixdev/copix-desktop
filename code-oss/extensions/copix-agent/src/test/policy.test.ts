import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditSession } from '../edits';
import { absorbPlainProviderKey, stringifySettings } from '../providerSecret';
import { applyPerformance, isTightRam, recommendedModel } from '../recommend';
import { looksLikeSecret } from '../utils/secrets';

test('OpenRouter keys are pulled out of settings and the file stays blank', () => {
	const absorbed = absorbPlainProviderKey({
		model: { provider: 'openrouter', apiKey: 'sk-or-v1-abcdef0123456789abcd', modelId: 'openai/gpt-4o' },
	});
	assert.equal(absorbed.changed, true);
	assert.equal(absorbed.apiKey.startsWith('sk-or-v1-'), true);
	const written = stringifySettings(absorbed.settings);
	assert.equal(written.includes('sk-or-v1-'), false);
	assert.match(written, /"apiKey": ""/);
});

test('stringifySettings blanks a key even if absorb was skipped', () => {
	const written = stringifySettings({ model: { apiKey: 'sk-live-secret' } });
	assert.equal(written.includes('sk-live'), false);
});

test('secret-shaped paths are refused', () => {
	assert.equal(looksLikeSecret('sk-or-v1-abcdef0123456789abcd'), true);
	assert.equal(looksLikeSecret('readme.md'), false);
});

test('accept writes the overlay and reject drops it', () => {
	const edits = new EditSession();
	edits.propose({ id: '1', path: '/tmp/a.ts', before: 'old', after: 'new', kind: 'edit' });
	assert.equal(edits.read('/tmp/a.ts', 'old'), 'new');
	assert.equal(edits.reject('/tmp/missing'), undefined);
	const rejected = edits.reject('/tmp/a.ts');
	assert.equal(rejected?.after, 'new');
	assert.equal(edits.read('/tmp/a.ts', 'old'), 'old');
	edits.propose({ id: '2', path: '/tmp/a.ts', before: 'old', after: 'newer', kind: 'write' });
	assert.equal(edits.accept('/tmp/a.ts')?.after, 'newer');
	assert.equal(edits.all().length, 0);
});

test('8 GB machines stay on the small model and a short context', () => {
	assert.equal(isTightRam(7.6), true);
	assert.equal(isTightRam(16), false);
	assert.equal(recommendedModel(8).id, 'qwen2.5:3b');
	assert.equal(recommendedModel(16).id, 'qwen2.5-coder:7b');
	const tuned = applyPerformance({ modelId: 'qwen2.5-coder:7b', apiKey: 'nope' }, 8, 8, 'qwen2.5:3b');
	assert.equal(tuned.modelId, 'qwen2.5:3b');
	assert.equal(tuned.apiKey, '');
	assert.equal(tuned.lowVram, true);
	assert.equal(tuned.singleModel, true);
	assert.equal(tuned.numCtx, 4096);
	assert.equal(tuned.numGpu, 0);
	assert.equal(tuned.numThread, 4);
});
