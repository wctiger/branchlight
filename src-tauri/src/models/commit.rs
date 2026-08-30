use serde::Serialize;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Commit {
    pub(crate) hash: String,
    pub(crate) parents: Vec<String>,
    pub(crate) refs: Vec<String>,
    pub(crate) subject: String,
    pub(crate) author: String,
    pub(crate) timestamp: i64,
}
