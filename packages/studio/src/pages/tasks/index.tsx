import { definePageComponent } from '@devias/core';
import { ids } from '../../ids';
import { TaskPage } from './task-page';
import { TasksPage } from './tasks-page';

export { TaskPage, TasksPage };

export const tasksPages = [
  definePageComponent({ id: ids.pages.tasks, path: 'tasks', component: TasksPage }),
  definePageComponent({ path: 'tasks/$taskId', component: TaskPage }),
];
