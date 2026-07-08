"use strict";

const { handleAdminRoutes } = require("./routes/admin");
const { handleDecisionRoutes } = require("./routes/decisions");
const { handleIntegrationRoutes } = require("./routes/integrations");
const { handleMobileRoutes } = require("./routes/mobile");
const { handlePublicAccessRoutes } = require("./routes/public-access");
const { handleSystemRoutes } = require("./routes/system");
const { handleTaskRoutes } = require("./routes/tasks");

const ROUTES = [
  handleSystemRoutes,
  handleIntegrationRoutes,
  handlePublicAccessRoutes,
  handleMobileRoutes,
  handleDecisionRoutes,
  handleTaskRoutes,
  handleAdminRoutes,
];

function createApiHandler(deps) {
  return async function handleApi(req, res, url) {
    for (const route of ROUTES) {
      if (await route(req, res, url, deps)) return;
    }
    return deps.sendJson(res, 404, { error: "Not found" });
  };
}

module.exports = {
  createApiHandler,
};
