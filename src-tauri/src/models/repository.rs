use serde::Serialize;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Repository {
    pub(crate) name: String,
    pub(crate) path: String,
}
