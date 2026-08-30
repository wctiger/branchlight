use serde::Serialize;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Branches {
    pub(crate) local: Vec<Branch>,
    pub(crate) remote: Vec<Branch>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Branch {
    pub(crate) name: String,
    pub(crate) full_ref: String,
    pub(crate) commit: Option<String>,
    pub(crate) is_current: bool,
    pub(crate) upstream: Option<String>,
}
