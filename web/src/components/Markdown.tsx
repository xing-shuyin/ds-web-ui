import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { CopyButton } from "./copy-button";

interface MarkdownProps {
	text: string;
}

/** GFM markdown with syntax highlighting; code blocks get a copy button. */
export const Markdown = memo(function Markdown({ text }: MarkdownProps) {
	return (
		<div className="md">
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				rehypePlugins={[
					[rehypeHighlight, { detect: true, ignoreMissing: true }],
				]}
				components={{
					pre: ({ children, ...props }) => (
						<div className="codeblock">
							<CopyButton text={codeText(children)} />
							<pre {...props}>{children}</pre>
						</div>
					),
				}}
			>
				{text}
			</ReactMarkdown>
		</div>
	);
});

function codeText(children: unknown): string {
	if (typeof children === "string") return children;
	if (Array.isArray(children)) return children.map(codeText).join("");
	if (children && typeof children === "object" && "props" in children) {
		const props = (children as { props?: { children?: unknown } }).props;
		return codeText(props?.children);
	}
	return "";
}
