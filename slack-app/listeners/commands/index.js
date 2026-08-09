import { beginOrderCommandCallback } from './sample-command.js';

export const register = (app) => {
  app.command('/begin-order', beginOrderCommandCallback);
};
