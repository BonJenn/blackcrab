import { useMemo, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

/**
 * Small, dependency-free markdown renderer tuned for chat transcripts:
 * headings, bold/italic, inline code, fenced code blocks, and bullet/numbered
 * lists. Anything it doesn't recognize falls through as plain text.
 */

type Block =
  | { type: "code"; text: string }
  | { type: "heading"; level: number; text: string }
  | { type: "bullet"; text: string }
  | { type: "numbered"; num: string; text: string }
  | { type: "para"; text: string };

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) {
      blocks.push({ type: "para", text: para.join(" ") });
      para = [];
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith("```")) {
      flush();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        code.push(lines[i]);
        i++;
      }
      blocks.push({ type: "code", text: code.join("\n") });
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flush();
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      flush();
      blocks.push({ type: "bullet", text: bullet[1] });
      continue;
    }
    const numbered = line.match(/^\s*(\d+)\.\s+(.*)$/);
    if (numbered) {
      flush();
      blocks.push({ type: "numbered", num: numbered[1], text: numbered[2] });
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return blocks;
}

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|_[^_]+_)/g;

function Inline({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(text))) {
    if (m.index > last) {
      nodes.push(<Text key={key++}>{text.slice(last, m.index)}</Text>);
    }
    const tok = m[0];
    if (tok.startsWith("**")) {
      nodes.push(
        <Text key={key++} style={styles.bold}>
          {tok.slice(2, -2)}
        </Text>,
      );
    } else if (tok.startsWith("`")) {
      nodes.push(
        <Text key={key++} style={styles.inlineCode}>
          {tok.slice(1, -1)}
        </Text>,
      );
    } else {
      nodes.push(
        <Text key={key++} style={styles.italic}>
          {tok.slice(1, -1)}
        </Text>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) {
    nodes.push(<Text key={key++}>{text.slice(last)}</Text>);
  }
  return <>{nodes}</>;
}

function headingStyle(level: number) {
  if (level === 1) return styles.h1;
  if (level === 2) return styles.h2;
  return styles.h3;
}

export function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  return (
    <View style={styles.root}>
      {blocks.map((b, i) => {
        switch (b.type) {
          case "code":
            return (
              <View key={i} style={styles.codeBlock}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <Text style={styles.codeText}>{b.text}</Text>
                </ScrollView>
              </View>
            );
          case "heading":
            return (
              <Text key={i} style={[styles.heading, headingStyle(b.level)]}>
                <Inline text={b.text} />
              </Text>
            );
          case "bullet":
            return (
              <View key={i} style={styles.listRow}>
                <Text style={styles.bulletMark}>•</Text>
                <Text style={styles.body}>
                  <Inline text={b.text} />
                </Text>
              </View>
            );
          case "numbered":
            return (
              <View key={i} style={styles.listRow}>
                <Text style={styles.numberMark}>{b.num}.</Text>
                <Text style={styles.body}>
                  <Inline text={b.text} />
                </Text>
              </View>
            );
          default:
            return (
              <Text key={i} style={styles.body}>
                <Inline text={b.text} />
              </Text>
            );
        }
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 8,
  },
  body: {
    flex: 1,
    color: "#e7eaee",
    fontSize: 15,
    lineHeight: 22,
  },
  bold: {
    fontWeight: "700",
    color: "#f4f6f8",
  },
  italic: {
    fontStyle: "italic",
  },
  inlineCode: {
    fontFamily: "Menlo",
    fontSize: 13,
    color: "#f0c8b0",
    backgroundColor: "#1a1f25",
  },
  heading: {
    color: "#f4f6f8",
    fontWeight: "700",
  },
  h1: { fontSize: 21, lineHeight: 27, marginTop: 2 },
  h2: { fontSize: 18, lineHeight: 24 },
  h3: { fontSize: 16, lineHeight: 22, color: "#cfd5dc" },
  listRow: {
    flexDirection: "row",
    gap: 8,
    paddingLeft: 2,
  },
  bulletMark: {
    color: "#e26a4b",
    fontSize: 15,
    lineHeight: 22,
  },
  numberMark: {
    color: "#e26a4b",
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "600",
    minWidth: 18,
  },
  codeBlock: {
    backgroundColor: "#0e1216",
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#1f242b",
    padding: 12,
  },
  codeText: {
    fontFamily: "Menlo",
    fontSize: 12.5,
    lineHeight: 19,
    color: "#d7dde3",
  },
});
