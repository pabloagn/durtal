# Refuse foreign hosts before malformed resource addresses

SLN-1050. Malformed API and build-file addresses now pass the host guard before returning the malformed-address response. Foreign hosts receive 421; allowed hosts still receive 400. Valid build-file GET/HEAD requests keep the existing public-asset shortcut.

Proxy regressions exercise GET, HEAD and POST (including a Next-Action header) for both resource path families. No configuration or live infrastructure changes.
