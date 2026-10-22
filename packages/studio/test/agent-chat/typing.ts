import { act } from '@testing-library/react';

/** The part of Tiptap's editor a test needs; the message box is one, reached through the element it renders into. */
interface MessageEditor {
  chain: () => { focus: (at: 'end') => { insertContent: (text: string) => { run: () => boolean } } };
  getText: () => string;
}

const editorOf = (element: HTMLElement): MessageEditor => (element as HTMLElement & { editor: MessageEditor }).editor;

/** Types `text` into the message box (appending to what is there). */
export const typeInto = (element: HTMLElement, text: string): void => {
  act(() => {
    editorOf(element).chain().focus('end').insertContent(text).run();
  });
};

/** What the message box holds, as plain text. */
export const textOf = (element: HTMLElement): string => editorOf(element).getText();
