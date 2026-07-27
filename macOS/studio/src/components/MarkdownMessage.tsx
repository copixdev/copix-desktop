import { memo, useCallback, type ReactNode } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function CodeBlock({ className, children }: { className?: string; children?: ReactNode }) {
	const lang = /language-(\w+)/.exec(className ?? '')?.[1] ?? '';
	const code = String(children).replace(/\n$/, '');
	const copy = useCallback(() => navigator.clipboard.writeText(code), [code]);
	return (
		<div className="code-block-wrap">
			<div className="code-block-header">
				<span>{lang || 'code'}</span>
				<button type="button" className="copy-btn" onClick={copy}>Copy</button>
			</div>
			<SyntaxHighlighter language={lang || 'text'} style={oneDark} PreTag="div" customStyle={{ margin: 0, borderRadius: '0 0 6px 6px', fontSize: 12 }}>
				{code}
			</SyntaxHighlighter>
		</div>
	);
}

export const MarkdownMessage = memo(function MarkdownMessage({ content }: { content: string }) {
	return (
		<div className="markdown-content">
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				components={{
					code({ className, children, ...props }) {
						const inline = !className;
						if (inline) {
							return <code className="inline-code" {...props}>{children}</code>;
						}
						return <CodeBlock className={className}>{children}</CodeBlock>;
					},
					table({ children, ...props }) {
						return (
							<div className="md-table-wrap">
								<table {...props}>{children}</table>
							</div>
						);
					},
				}}
			>
				{content}
			</ReactMarkdown>
		</div>
	);
});
