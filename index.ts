#!/usr/bin/env node

import { dirname, join } from "path";
import {
  writeFile,
  mkdtemp,
  mkdir,
  copyFile,
  rm,
  readFile,
  unlink,
} from "fs/promises";
import { createWriteStream, existsSync, PathLike } from "fs";
import parseArgs from "minimist";
import { tmpdir } from "os";
import { Readable } from "stream";
import { finished } from "stream/promises";
import { getInstalledSteamApps, SteamApp } from "steam-locate";
import { SteamCmd } from "steamcmd-interface";
import { parse } from "kvparser";
import { parseICO } from "icojs";
import sanitize from "sanitize-filename";
import { ReadableStream } from "stream/web";

console.log("Initializing SteamCMD...");
const steamcmd = await SteamCmd.init({});

var argv = parseArgs(process.argv.slice(2));

const forceOverwrite = argv.O ?? false;
const removeDesktops = argv.R ?? false;

const applicationPath =
  argv.o ??
  join(process.env["HOME"]!, ".local", "share", "applications", "steam");
const iconPath =
  argv.io ?? join(process.env["HOME"]!, ".local", "share", "icons", "hicolor");
const tmpDir = await mkdtemp(join(tmpdir(), "sdfg-"));
const steamIconBase =
  argv.icon_cdn ??
  "https://shared.fastly.steamstatic.com/community_assets/images/apps/";

interface IcoImage {
  path: string;
  width: number;
  height: number;
  bitdepth: number;
}

async function extractIco(src: string | null, dest: PathLike) {
  if (!src) return;

  const results: IcoImage[] = [];
  await mkdir(dest);
  const buffer = await readFile(src);
  const images = await parseICO(buffer, "image/png");

  for (const image of images) {
    const file = join(
      dest.toString(),
      `${image.width}x${image.height}-${image.bpp}bit.png`
    );
    const data = Buffer.from(image.buffer);
    await writeFile(file, data);
    results.push({
      path: file,
      width: image.width,
      height: image.height,
      bitdepth: image.bpp,
    });
  }

  return results;
}

async function getAppInfo(app_id: string): Promise<any> {
  const lines: string[] = steamcmd.run([`app_info_print ${app_id}`]);
  let kvStr = "";
  for await (const line of lines) {
    if (line.startsWith("quit")) break;
    else if (kvStr == "" && line.includes(`"${app_id}"`))
      kvStr = line.substring(line.indexOf(`"${app_id}"`));
    else if (kvStr != "") kvStr += line;
  }
  const obj = parse(kvStr);
  return obj;
}

async function downloadIcon(app_id: string, info: any) {
  const iconHash = info[app_id]?.common?.clienticon;

  if (!iconHash) return null;

  const dest = join(tmpDir, iconHash);
  if (existsSync(dest)) return dest;

  const url = `${steamIconBase}${app_id}/${iconHash}.ico`;

  const res = await fetch(url);
  if (res.ok && res.body) {
    const fileStream = createWriteStream(dest, { flags: "wx" });
    await finished(
      Readable.fromWeb(<ReadableStream<any>>res.body).pipe(fileStream)
    );
    return dest;
  }

  console.error(`Could not fetch icon! ${await res.text()}`);
  return null;
}

async function installIcon(app_id: string, info: any) {
  try {
    const ico = await downloadIcon(app_id, info);
    if (!ico) return false;

    const sizes = await extractIco(ico, join(tmpDir, `${app_id}/`));
    if (!sizes) return false;

    let succeeded = false;
    const highestDepth = Math.max(...sizes.map((v) => v.bitdepth));
    for (const v of sizes) {
      if (!v) continue;

      if (v.height != v.width) {
        console.error(`Icon '${v.path}' is not square!`);
        continue;
      }

      if (v.bitdepth != highestDepth)
        // Just ignore bit depths that are lower than the highest
        continue;

      const iconDir = join(iconPath, `${v.width}x${v.height}/`, "apps/");
      if (!existsSync(iconDir)) continue;

      try {
        const destPath = join(iconDir, `steam_icon_${app_id}.png`);
        if (!forceOverwrite && existsSync(destPath)) {
          console.log(`Skipping icon as it already exists: ${v.path}`);
          succeeded = true;
          continue;
        }
        await copyFile(v.path, destPath);
        succeeded = true;
      } catch (err) {
        console.error(err);
        // stub
      }
    }
    return succeeded;
  } catch (e) {
    console.error("Failed to get icon: ", e);
    return false;
  }
}

async function createDesktopFile(game: SteamApp) {
  try {
    const appInfo = await getAppInfo(game.appId);

    if (
      !appInfo[game.appId]?.config?.["launch"] ||
      (<any>(
        Object.values(appInfo[game.appId].config.launch)[0]
      )).executable.startsWith("steam://")
    ) {
      console.log(`Ignoring non-executable app: ${game.name}`);
      return;
    }

    const icon = (await installIcon(game.appId, appInfo))
      ? `steam_icon_${game.appId}`
      : "steam";

    const desktopFileContent = `[Desktop Entry]\nName=${game.name}\nComment=Play this game on Steam\nExec=steam steam://rungameid/${game.appId}\nIcon=${icon}\nTerminal=false\nType=Application\nCategories=Game;\n\n`;

    try {
      const desktopPath = join(
        applicationPath,
        sanitize(`${game.name}.desktop`)
      );
      if (!existsSync(dirname(desktopPath))) await mkdir(dirname(desktopPath));
      await writeFile(desktopPath, desktopFileContent); // Create a .desktop file for the game
      console.log(`Created .desktop file for '${game.name}' (${game.appId}).`);
    } catch (error) {
      console.error(error);
    }
  } catch (error) {
    console.error(error);
  }
}

async function createAllDesktops() {
  try {
    console.log("Getting installed steam apps...");
    const games = await getInstalledSteamApps();
    console.log(`Found ${games.length} games.`);
    console.log(`Creating .desktop files...`);
    for (const game of games) {
      console.log(`Processing ${game.name}...`);
      await createDesktopFile(game);
    }
  } catch (err) {
    console.error(err);
  }
}

async function removeAllDesktops() {
  try {
    console.log("Getting installed steam apps...");
    const games = await getInstalledSteamApps();
    console.log(`Found ${games.length} games.`);
    console.log(`Removing .desktop files...`);
    for (const game of games) {
      const desktopPath = join(
        applicationPath,
        sanitize(`${game.name}.desktop`)
      );
      if (existsSync(desktopPath)) unlink(desktopPath);
      console.log(`Removing ${desktopPath}`);
    }
  } catch (err) {
    console.error(err);
  }
}

removeDesktops ? await removeAllDesktops() : await createAllDesktops();
await rm(tmpDir, { recursive: true });
