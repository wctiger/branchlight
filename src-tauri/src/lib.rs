mod commands;
mod git;
mod mcp;
mod models;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let repositories = mcp::OpenRepositories::default();
            if std::env::args_os().any(|arg| arg == "--mcp") {
                let server = tauri::async_runtime::block_on(mcp::start(repositories.clone()))?;
                app.manage(server);
            }
            app.manage(repositories);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            mcp::set_mcp_repositories,
            commands::system::get_git_version,
            commands::delivery::get_remotes,
            commands::delivery::create_branch_at,
            commands::delivery::checkout_remote_branch,
            commands::delivery::set_branch_upstream,
            commands::delivery::review_push,
            commands::delivery::force_push,
            commands::delivery::compose_commit,
            commands::inspection::discard_file,
            commands::inspection::compare_revisions,
            commands::inspection::get_text_diff,
            commands::inspection::get_file_history,
            commands::inspection::get_file_blame,
            commands::repository::open_repository,
            commands::repository::create_repository,
            commands::repository::get_repository_status,
            commands::branches::get_branches,
            commands::branches::switch_branch,
            commands::branches::create_branch,
            commands::branches::rename_branch,
            commands::branches::delete_branch,
            commands::branches::merge_branch,
            commands::branches::rebase_onto_branch,
            commands::conflicts::abort_merge,
            commands::conflicts::abort_rebase,
            commands::conflicts::recover_rebase,
            commands::conflicts::get_conflict_file,
            commands::conflicts::save_conflict_file,
            commands::tags::get_local_tags,
            commands::tags::inspect_local_tag,
            commands::tags::create_local_tag,
            commands::tags::delete_local_tag,
            commands::external_tools::launch_external_tool,
            commands::external_tools::get_launcher_status,
            commands::submodules::get_submodules,
            commands::submodules::open_submodule,
            commands::submodules::review_submodule_action,
            commands::submodules::execute_submodule_action,
            commands::lfs::get_lfs_state,
            commands::lfs::review_lfs_prune,
            commands::lfs::execute_lfs_action,
            commands::lfs::get_lfs_progress,
            commands::history::get_history,
            commands::history::search_history,
            commands::history_operations::execute_history_action,
            commands::history_operations::get_rebase_plan,
            commands::history_operations::abort_history_operation,
            commands::history_operations::get_diagnostics,
            commands::operations::stage_file,
            commands::operations::unstage_file,
            commands::operations::commit,
            commands::stashes::get_stashes,
            commands::stashes::create_stash,
            commands::stashes::apply_stash,
            commands::stashes::pop_stash,
            commands::stashes::drop_stash,
            commands::remotes::fetch_remote,
            commands::remotes::pull_remote,
            commands::remotes::push_remote
        ])
        .build(tauri::generate_context!())
        .expect("error while starting Branchlight")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(server) = app.try_state::<mcp::ServerShutdown>() {
                    server.stop();
                }
            }
        });
}
