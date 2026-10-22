// The document model lives in core, where the engine, the agent and the studio share it.
export {
  EMPTY_DOC,
  isRichTextDoc,
  MENTION_NODE,
  markdownToRichText,
  mentionsOf,
  mentionsRecordFilter,
  plainText,
  type RecordMention,
  type RichTextDoc,
  type RichTextNode,
  richTextToMarkdown,
  toRichTextDoc,
} from '@devias/core';
