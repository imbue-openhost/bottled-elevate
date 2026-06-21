import os

import attr


@attr.s(auto_attribs=True, frozen=True)
class Config:
    static_dir: str
    sqlite_path: str
    router_url: str
    app_token: str
    health_shortname: str

    @property
    def health_service_base_url(self) -> str:
        return f"{self.router_url.rstrip('/')}/api/services/v2/call/{self.health_shortname}"


def _require(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Required environment variable {name} is not set")
    return value


def load_config() -> Config:
    return Config(
        static_dir=os.environ.get("ELEVATE_STATIC_DIR", "/app/static"),
        sqlite_path=_require("OPENHOST_SQLITE_MAIN"),
        router_url=_require("OPENHOST_ROUTER_URL"),
        app_token=_require("OPENHOST_APP_TOKEN"),
        health_shortname=os.environ.get("ELEVATE_HEALTH_SHORTNAME", "health"),
    )
