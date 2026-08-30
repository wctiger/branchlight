use serde::Serialize;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Stash {
    pub(crate) reference: String,
    pub(crate) commit: String,
    pub(crate) message: String,
}
