use serde::Serialize;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitOutput {
    pub(crate) stdout: String,
    pub(crate) stderr: String,
    pub(crate) exit_code: Option<i32>,
    #[serde(skip)]
    pub(crate) stdout_bytes: Vec<u8>,
}
