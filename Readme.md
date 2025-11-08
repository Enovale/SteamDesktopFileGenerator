# SteamDesktopFileGenerator

This script generates .desktop files for all steam games from the provided path

# Dependencies

* Nodejs
* pnpm

# Usage

`pnpm i`  
`pnpm start`

The desktop files will be created at `$HOME/.local/share/applications/steam` by default.

## Arguments

`-o`: Where to output the desktop files.  
`-io`: Where to output the icon files.  
`-O`: Force icons to be overwritten (in case of writing errors on a previous attempt).  
`-R`: Remove all desktop files instead of creating them  
`-icon_cdn`: Endpoint to get the ico files from, e.g. https://shared.fastly.steamstatic.com/community_assets/images/apps/