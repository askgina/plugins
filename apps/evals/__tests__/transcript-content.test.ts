import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { TranscriptContent, formatTranscriptJson } from "../src/components/transcript-content";

const render = (text: string, source = false, data = false) =>
  renderToStaticMarkup(createElement(TranscriptContent, { text, source, data }));

describe("transcript formatting", () => {
  test("renders headings, emphasis, lists, tables, links and fenced code", () => {
    const html = render(
      '## Market summary\n\n**AAVE** has *variable* supply.\n\n- First item\n- Second item\n\n| Asset | Price |\n| --- | --- |\n| AAVE | 100 |\n\n[Official source](https://example.com)\n\n```json\n{"price":100}\n```',
    );
    expect(html).toContain("<h2>Market summary</h2>");
    expect(html).toContain("<strong>AAVE</strong>");
    expect(html).toContain("<em>variable</em>");
    expect(html).toContain("<li>First item</li>");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>Asset</th>");
    expect(html).toContain('aria-label="Message table"');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('<pre><code class="language-json">');
  });

  test("escapes HTML and blocks active URLs and automatic external image loads", () => {
    const html = render(
      '<script>alert(1)</script>\n\n<img src="https://example.com/tracker" onerror="alert(2)">\n\n[bad](javascript:alert%281%29)\n\n![Chart](https://example.com/chart.png)\n\n[encoded](jav&#x61;script:alert%281%29)',
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('src="https://');
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Image: Chart");
    expect(html).toContain('href="https://example.com/chart.png"');
  });

  test("keeps the original Markdown and long contents available in source mode", () => {
    const text = "## Heading\n\n**Original** text\n" + "retained text ".repeat(2000);
    const html = render(text, true);
    expect(html).toContain("## Heading\n\n**Original** text");
    expect(html).not.toContain("<h2>");
    expect(html.match(/retained text /gu)).toHaveLength(2000);
  });

  test("pretty-prints JSON while preserving large numbers, escaped strings and duplicate keys", () => {
    const input =
      '{"id":123456789012345678901234567890,"note":"braces { } and \\"quotes\\"","empty":[],"same":1,"same":2}';
    const formatted = formatTranscriptJson(input);
    expect(formatted).toContain('  "id": 123456789012345678901234567890,');
    expect(formatted).toContain('"note": "braces { } and \\"quotes\\""');
    expect(formatted).toContain('"empty": []');
    expect(formatted).toContain('"same": 1,\n  "same": 2');
    expect(formatTranscriptJson("[redacted:private_account]")).toBeUndefined();
    expect(formatTranscriptJson('{"incomplete":')).toBeUndefined();
    expect(render(input, false, true)).toContain('data-token="key"');
    expect(render(input, true, true)).toContain("123456789012345678901234567890");
  });
});
