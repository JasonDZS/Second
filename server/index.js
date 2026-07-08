"use strict";

const { startServer } = require("./app");

const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const hostArg = process.argv.find((arg) => arg.startsWith("--host="));
const port = portArg ? Number(portArg.split("=")[1]) : undefined;
const host = hostArg ? hostArg.split("=")[1] : process.env.HOST || "127.0.0.1";

startServer({ port, host })
  .then(({ url }) => {
    process.stdout.write(`Second daemon listening at ${url}\n`);
  })
  .catch((error) => {
    process.stderr.write(`Failed to start Second daemon: ${error.message}\n`);
    process.exit(1);
  });
