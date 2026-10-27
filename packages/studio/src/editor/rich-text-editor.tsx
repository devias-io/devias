import type { TextAnchor } from '@devias/core';
import { cn, Icon, type IconName } from '@devias/ui';
import { type Editor, EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useClient } from '../providers/client';
import './rich-text-editor.css';
import { useWorkspace } from '../providers/workspace';
import { type CommentAnchor, CommentAnchors, refreshCommentAnchors, selectionAnchor } from './comment-anchors';
import { CurrentLineHint } from './current-line-hint';
import { lookupEntities } from './lookup';
import { MarkdownPaste } from './markdown-paste';
import { createRecordMention } from './record-mention';
import { type RichTextDoc, toRichTextDoc } from './rich-text';
import { contentExtensions } from './schema';
import { SlashCommand } from './slash-command';

/** Comments on the text of a document: what to underline, which one is looked at, and what to do when asked. */
export interface RichTextComments {
  anchors: readonly CommentAnchor[];
  activeId: string | null;
  /** Text with a comment on it was clicked (its id), or text without one (null). */
  onActivate: (id: string | null) => void;
  /** The comments whose text is in the document, in the order of the text: after each refresh and when typing changes it. */
  onPlaced: (ids: string[]) => void;
  /** The person asked to comment on the selected text: the toolbar's Comment button, or ⌘⌥M. */
  onComment: (anchor: TextAnchor) => void;
}

export interface RichTextEditorProps {
  value: unknown;
  onChange?: (doc: RichTextDoc) => void;
  onBlur?: () => void;
  editable?: boolean;
  autoFocus?: boolean;
  /** `page`: the full document page (large type, selection toolbar); `compact`: forms and popovers. */
  variant?: 'page' | 'compact';
  /** Receives the Tiptap editor, e.g. to move focus into it from a title field. */
  editorRef?: RefObject<Editor | null>;
  /** Comments on the text (the document page): underlined, with a Comment button over a selection. Read at mount. */
  comments?: RichTextComments;
  className?: string;
}

const HINTS = {
  page: "Write, press '/' for blocks or '@' to mention",
  compact: 'Write, or type @ to mention a record…',
};

/** Rich-text editor for `rich_text` values: `/` inserts blocks, `@` mentions records and renders them as links. */
export function RichTextEditor({
  value,
  onChange,
  onBlur,
  editable = true,
  autoFocus = false,
  variant = 'compact',
  editorRef,
  comments,
  className,
}: RichTextEditorProps) {
  const client = useClient();
  const { members } = useWorkspace();
  const peopleRef = useRef(members);
  useLayoutEffect(() => {
    peopleRef.current = members;
  });
  // The editor is created once; callbacks are read through a ref so they can change between renders.
  const callbacks = useRef({ onChange, onBlur, comments });
  useLayoutEffect(() => {
    callbacks.current = { onChange, onBlur, comments };
  });
  const editor = useEditor(
    {
      extensions: [
        ...contentExtensions,
        CurrentLineHint.configure({
          // An empty document says what it takes; after that only blocks that are not plain text name themselves,
          // so a heading, list, to-do or quote that is still empty says what it is.
          hint: ({ name, level, parent, empty }) => {
            if (name === 'heading') {
              return `Heading ${level}`;
            }

            if (parent === 'listItem') {
              return 'List';
            }

            if (parent === 'taskItem') {
              return 'To-do';
            }

            if (parent === 'blockquote') {
              return 'Quote';
            }

            return empty ? HINTS[variant] : '';
          },
        }),
        createRecordMention((text) => lookupEntities(client, text, { members: peopleRef.current })),
        SlashCommand,
        MarkdownPaste,
        ...(comments
          ? [
              CommentAnchors.configure({
                anchors: () => callbacks.current.comments?.anchors ?? [],
                active: () => callbacks.current.comments?.activeId ?? null,
                onActivate: (id) => callbacks.current.comments?.onActivate(id),
                onPlaced: (ids) => callbacks.current.comments?.onPlaced(ids),
                onComment: (anchor) => callbacks.current.comments?.onComment(anchor),
              }),
            ]
          : []),
      ],
      content: toRichTextDoc(value),
      editable,
      autofocus: autoFocus ? 'end' : false,
      editorProps: { attributes: { class: `doc-editor doc-editor--${variant}` } },
      onUpdate: ({ editor: current }) => callbacks.current.onChange?.(current.getJSON() as RichTextDoc),
      onBlur: () => callbacks.current.onBlur?.(),
    },
    [],
  );

  useEffect(() => {
    if (!editorRef) {
      return;
    }

    editorRef.current = editor;

    return () => {
      editorRef.current = null;
    };
  }, [editor, editorRef]);

  useEffect(() => {
    editor?.setEditable(editable, false);
  }, [editor, editable]);

  // Underline again when the comments, or the one looked at, change.
  const anchors = comments?.anchors;
  const activeId = comments?.activeId;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the lists are what the underlines are drawn from
  useEffect(() => {
    if (editor?.isInitialized && anchors) {
      refreshCommentAnchors(editor);
    }
  }, [editor, anchors, activeId]);

  // Take in outside changes (another tab, the agent) unless the user is typing here.
  useEffect(() => {
    if (!editor || editor.isFocused) {
      return;
    }

    const next = toRichTextDoc(value);

    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(next)) {
      editor.commands.setContent(next, { emitUpdate: false });
    }
  }, [editor, value]);

  return (
    <>
      <EditorContent editor={editor} className={cn('min-w-0', className)} />
      {/* In forms and popovers the toolbar would render outside the dialog; keyboard shortcuts still work there. */}
      {editor && editable && variant === 'page' ? (
        <FormatToolbar
          editor={editor}
          onComment={comments ? (anchor) => callbacks.current.comments?.onComment(anchor) : undefined}
        />
      ) : null}
      {editor && editable ? <TableToolbar editor={editor} /> : null}
    </>
  );
}

interface Mark {
  key: 'bold' | 'italic' | 'underline' | 'strike' | 'code';
  title: string;
  label?: string;
  icon?: IconName;
  className?: string;
}

const MARKS: Mark[] = [
  { key: 'bold', title: 'Bold · ⌘B', label: 'B', className: 'font-bold' },
  { key: 'italic', title: 'Italic · ⌘I', label: 'i', className: 'font-serif italic' },
  { key: 'underline', title: 'Underline · ⌘U', label: 'U', className: 'underline underline-offset-2' },
  { key: 'strike', title: 'Strikethrough · ⌘⇧S', label: 'S', className: 'line-through' },
  { key: 'code', title: 'Code · ⌘E', icon: 'code' },
];

const toggleMark = (editor: Editor, key: Mark['key']) => {
  const chain = editor.chain().focus();

  if (key === 'bold') {
    chain.toggleBold();
  } else if (key === 'italic') {
    chain.toggleItalic();
  } else if (key === 'underline') {
    chain.toggleUnderline();
  } else if (key === 'strike') {
    chain.toggleStrike();
  } else {
    chain.toggleCode();
  }

  chain.run();
};

/** An inline toolbar over the selected text. */
function FormatToolbar({
  editor,
  onComment,
}: {
  editor: Editor;
  onComment: ((anchor: TextAnchor) => void) | undefined;
}) {
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      Object.fromEntries(MARKS.map((mark) => [mark.key, current.isActive(mark.key)])) as Record<Mark['key'], boolean>,
  });

  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: 'top', offset: 8 }}
      className="z-50 flex items-center gap-0.5 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {MARKS.map((mark) => (
        <button
          key={mark.key}
          type="button"
          title={mark.title}
          aria-label={mark.title}
          aria-pressed={active[mark.key]}
          className={cn(
            'flex size-7 items-center justify-center rounded-md text-xs text-muted-foreground hover:bg-accent hover:text-foreground',
            active[mark.key] && 'bg-accent text-foreground',
            mark.className,
          )}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => toggleMark(editor, mark.key)}
        >
          {mark.icon ? <Icon name={mark.icon} className="size-3.5" /> : mark.label}
        </button>
      ))}
      {onComment ? (
        <>
          <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />
          <button
            type="button"
            title="Comment · ⌘⌥M"
            aria-label="Comment on the selection"
            className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              const anchor = selectionAnchor(editor);

              if (anchor) {
                onComment(anchor);
              } else {
                toast.error('Select some text, up to 500 characters, to comment on');
              }
            }}
          >
            <Icon name="message-square" className="size-3.5" /> Comment
          </button>
        </>
      ) : null}
    </BubbleMenu>
  );
}

interface TableAction {
  key: string;
  label: string;
  title: string;
  run: (editor: Editor) => void;
  destructive?: boolean;
}

const TABLE_ACTIONS: TableAction[] = [
  { key: 'row', label: '+ Row', title: 'Add a row below', run: (e) => void e.chain().focus().addRowAfter().run() },
  {
    key: 'column',
    label: '+ Column',
    title: 'Add a column to the right',
    run: (e) => void e.chain().focus().addColumnAfter().run(),
  },
  {
    key: 'header',
    label: 'Header',
    title: 'Turn the first row into a header, or back',
    run: (e) => void e.chain().focus().toggleHeaderRow().run(),
  },
  {
    key: 'delete-row',
    label: 'Row ×',
    title: 'Delete this row',
    run: (e) => void e.chain().focus().deleteRow().run(),
    destructive: true,
  },
  {
    key: 'delete-column',
    label: 'Column ×',
    title: 'Delete this column',
    run: (e) => void e.chain().focus().deleteColumn().run(),
    destructive: true,
  },
  {
    key: 'delete-table',
    label: 'Delete table',
    title: 'Delete the whole table',
    run: (e) => void e.chain().focus().deleteTable().run(),
    destructive: true,
  },
];

/** Over a table while the cursor (or a selection of cells) is in it: add and remove rows and columns, or the table. */
function TableToolbar({ editor }: { editor: Editor }) {
  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: 'top-start', offset: 8 }}
      shouldShow={({ editor: current, state }) =>
        current.isActive('table') && (state.selection.empty || '$anchorCell' in state.selection)
      }
      className="z-50 flex items-center gap-0.5 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
      data-slot="table-toolbar"
    >
      {TABLE_ACTIONS.map((action) => (
        <button
          key={action.key}
          type="button"
          title={action.title}
          aria-label={action.title}
          className={cn(
            'h-7 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground',
            action.destructive && 'hover:text-destructive',
          )}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => action.run(editor)}
        >
          {action.label}
        </button>
      ))}
    </BubbleMenu>
  );
}
