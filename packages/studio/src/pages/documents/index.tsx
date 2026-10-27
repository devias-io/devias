import { definePageComponent } from '@devias/core';
import { ids } from '../../ids';
import { DocumentPage } from './document-page';
import { DocumentsPage } from './documents-page';

export { DocumentPage, DocumentsPage };

export const documentsPages = [
  definePageComponent({ id: ids.pages.documents, path: 'documents', component: DocumentsPage }),
  definePageComponent({ path: 'documents/$documentId', component: DocumentPage }),
];
