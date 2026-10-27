export type { Editor as RichTextEditorHandle } from '@tiptap/react';
export { ChatInput, type ChatInputHandle, type ChatInputProps } from './chat-input';
export { type CommentAnchor, commentRange, scrollToComment } from './comment-anchors';
export { lookupEntities } from './lookup';
export {
  EMPTY_DOC,
  isRichTextDoc,
  MENTION_NODE,
  mentionsOf,
  mentionsRecordFilter,
  plainText,
  type RecordMention,
  type RichTextDoc,
  type RichTextNode,
  toRichTextDoc,
} from './rich-text';
export { type RichTextComments, RichTextEditor, type RichTextEditorProps } from './rich-text-editor';
