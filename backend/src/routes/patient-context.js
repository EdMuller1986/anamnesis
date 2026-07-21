import { Hono } from 'hono';

const patientContext = new Hono();

patientContext.get('/', async (c) => {
  return c.json({ context: "Patient context summary will be here (AI generated)" });
});

export default patientContext;
