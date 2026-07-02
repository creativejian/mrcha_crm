import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// 업무 AI 답변 마크다운 렌더. raw HTML 미허용(react-markdown 기본 = XSS 안전).
export function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="md-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
