// Hooks into the app's lifecycle: https://fsn.dev/cli#hooks
import { app } from 'electron';
import type { Hooks } from '@fsn.dev/cli';

// Quit when the last window closes, on macOS too.
export const windowAllClosed: Hooks['windowAllClosed'] = () => {
  app.quit();
};
