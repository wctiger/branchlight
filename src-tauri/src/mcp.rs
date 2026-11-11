use crate::git::diagnostics;
use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{ServerCapabilities, ServerConfig},
    schemars, tool, tool_handler, tool_router,
    transport::streamable_http_server::{
        session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
    },
    ServerHandler,
};
use std::{
    collections::HashSet,
    path::Path,
    sync::{Arc, RwLock},
};
use tokio_util::sync::CancellationToken;

const ADDRESS: &str = "127.0.0.1:47831";

#[derive(Default, Clone)]
pub(crate) struct OpenRepositories(Arc<RwLock<HashSet<String>>>);

#[tauri::command]
pub(crate) fn set_mcp_repositories(
    paths: Vec<String>,
    repositories: tauri::State<'_, OpenRepositories>,
) -> Result<(), String> {
    *repositories
        .0
        .write()
        .map_err(|_| "Workspace unavailable")? = paths.into_iter().collect();
    Ok(())
}

#[derive(serde::Deserialize, schemars::JsonSchema)]
struct RepositoryRequest {
    /// Absolute worktree root as opened in Branchlight.
    repository: String,
}

#[derive(Clone)]
struct LogServer {
    repositories: OpenRepositories,
    tool_router: ToolRouter<Self>,
}

#[tool_router]
impl LogServer {
    #[tool(
        description = "Read recent Git operation metadata for an open Branchlight repository, newest first.",
        annotations(read_only_hint = true)
    )]
    fn read_operation_log(
        &self,
        Parameters(request): Parameters<RepositoryRequest>,
    ) -> Result<String, String> {
        let paths = self
            .repositories
            .0
            .read()
            .map_err(|_| "Workspace unavailable")?;
        if !paths.contains(&request.repository) {
            return Err("Repository is not open in Branchlight".into());
        }
        serde_json::to_string(&diagnostics::recent_operations(Path::new(
            &request.repository,
        )))
        .map_err(|error| error.to_string())
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for LogServer {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
    }
}

pub(crate) struct ServerShutdown(CancellationToken);

impl ServerShutdown {
    pub(crate) fn stop(&self) {
        self.0.cancel();
    }
}

pub(crate) async fn start(repositories: OpenRepositories) -> std::io::Result<ServerShutdown> {
    let listener = tokio::net::TcpListener::bind(ADDRESS)
        .await
        .map_err(|error| {
            std::io::Error::new(
                error.kind(),
                format!("Cannot start Branchlight MCP on {ADDRESS}: {error}"),
            )
        })?;
    let config = StreamableHttpServerConfig::default()
        .with_allowed_hosts([ADDRESS])
        .enforce_origin_validation();
    let shutdown = config.cancellation_token.clone();
    let service: StreamableHttpService<_, LocalSessionManager> = StreamableHttpService::new(
        move || {
            Ok(LogServer {
                repositories: repositories.clone(),
                tool_router: LogServer::tool_router(),
            })
        },
        Default::default(),
        config,
    );
    let router = axum::Router::new().route_service("/mcp", service);
    let stopped = shutdown.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = axum::serve(listener, router)
            .with_graceful_shutdown(stopped.cancelled_owned())
            .await
        {
            eprintln!("Branchlight MCP server stopped: {error}");
        }
    });
    Ok(ServerShutdown(shutdown))
}
