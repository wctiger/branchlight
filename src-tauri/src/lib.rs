mod commands;
mod git;
mod models;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::system::get_git_version,
            commands::repository::open_repository,
            commands::repository::get_repository_status,
            commands::branches::get_branches,
            commands::branches::switch_branch,
            commands::branches::create_branch,
            commands::branches::rename_branch,
            commands::branches::delete_branch,
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
