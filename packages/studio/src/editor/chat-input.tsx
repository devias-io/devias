import { richTextToMessage } from '@devias/core';
import { cn } from '@devias/ui';
import { type Editor, EditorContent, Extension, useEditor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react';
import { useClient } from '../providers/client';
import { useWorkspace } from '../providers/workspace';
import { CurrentLineHint } from './current-line-hint';
import { lookupEntities } from './lookup';
import { createRecordMention, recordMentionKey } from './record-mention';
import './rich-text-editor.css';

export interface ChatInputHandle {
  focus: () => void;
  clear: () => void;
  /** The message as it would be sent, empty when there is nothing to send. */
  markdown: () => string;
}

export interface ChatInputProps {
  /** What the box says while it is empty. */
  placeholder: string;
  ariaLabel: string;
  disabled?: boolean;
  /** Enter sends: the message as Markdown, with a mentioned record written `[Label](record:<object>/<id>)`. */
  onSubmit: (markdown: string) => void;
  /** Whether the box has anything in it, for a send button. */
  onEmptyChange?: (empty: boolean) => void;
  /** Escape, which a streaming reply takes as "stop". */
  onEscape?: () => void;
  handleRef?: RefObject<ChatInputHandle | null>;
  className?: string;
}

/** The text of the box as a message: its paragraphs and breaks as written, records as `record:` links. */
const markdownOf = (editor: Editor): string => richTextToMessage(editor.getJSON()).trim();

/**
 * A message box where `@` mentions a record or a workflow, which shows as a chip and goes out as a Markdown link the
 * agent understands (`record:<object>/<id>` or `workflow:<id>`). Plain text otherwise: no blocks or formatting, Enter sends and Shift+Enter starts a new line.
 */
export function ChatInput({
  placeholder,
  ariaLabel,
  disabled = false,
  onSubmit,
  onEmptyChange,
  onEscape,
  handleRef,
  className,
}: ChatInputProps) {
  const client = useClient();
  const { members } = useWorkspace();
  const peopleRef = useRef(members);
  useLayoutEffect(() => {
    peopleRef.current = members;
  });
  // The editor is created once; callbacks are read through a ref so they can change between renders.
  const callbacks = useRef({ onSubmit, onEmptyChange, onEscape, disabled, placeholder });
  useLayoutEffect(() => {
    callbacks.current = { onSubmit, onEmptyChange, onEscape, disabled, placeholder };
  });
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          blockquote: false,
          bold: false,
          bulletList: false,
          code: false,
          codeBlock: false,
          heading: false,
          horizontalRule: false,
          italic: false,
          link: false,
          listItem: false,
          listKeymap: false,
          orderedList: false,
          strike: false,
          trailingNode: false,
          underline: false,
        }),
        CurrentLineHint.configure({ hint: ({ empty }) => (empty ? callbacks.current.placeholder : '') }),
        createRecordMention((text) => lookupEntities(client, text, { workflows: true, members: peopleRef.current }), {
          heading: 'Mention a record, a person or a workflow',
          start: 'Type to search records, people, tasks and workflows…',
          none: 'No matches',
        }),
        // Ahead of the editor's own Enter (which splits the line), but not while the mention menu is open: it takes Enter.
        Extension.create({
          name: 'chatKeys',
          priority: 1000,
          addKeyboardShortcuts() {
            return {
              Enter: ({ editor: current }) => {
                if (recordMentionKey.getState(current.state)?.active) {
                  return false;
                }

                if (callbacks.current.disabled) {
                  return true;
                }

                const markdown = markdownOf(current);

                if (markdown) {
                  callbacks.current.onSubmit(markdown);
                }

                return true;
              },
              Escape: () => {
                callbacks.current.onEscape?.();

                return Boolean(callbacks.current.onEscape);
              },
            };
          },
        }),
      ],
      editable: !disabled,
      editorProps: { attributes: { class: 'doc-editor doc-editor--chat', role: 'textbox', 'aria-label': ariaLabel } },
      onUpdate: ({ editor: current }) => callbacks.current.onEmptyChange?.(current.isEmpty),
    },
    [],
  );
  useEffect(() => {
    editor?.setEditable(!disabled, false);
  }, [editor, disabled]);
  // The hint is drawn from the state, so a new placeholder needs a transaction to show.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `placeholder` is what triggers the redraw
  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      editor.view.dispatch(editor.state.tr);
    }
  }, [editor, placeholder]);
  useEffect(() => {
    if (!handleRef || !editor) {
      return;
    }

    handleRef.current = {
      focus: () => editor.commands.focus('end'),
      markdown: () => markdownOf(editor),
      clear: () => {
        editor.commands.clearContent(true);
        callbacks.current.onEmptyChange?.(true);
      },
    };

    return () => {
      handleRef.current = null;
    };
  }, [editor, handleRef]);

  return <EditorContent editor={editor} className={cn('min-w-0', className)} />;
}
