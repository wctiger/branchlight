use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Stash {
    pub(crate) reference: String,
    pub(crate) commit: String,
    pub(crate) message: String,
}
