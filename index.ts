#!/usr/bin/env node

import { normalize, join } from 'path'
import { readdir, stat, readFile, writeFile, mkdtemp, rmdir, mkdir } from 'fs/promises'
import { createWriteStream, existsSync } from 'fs'
import parseArgs from 'minimist'
import { exec, spawn } from 'child_process';
import { tmpdir } from 'os';
import { Readable } from 'stream';
import { finished } from 'stream/promises';

var argv = parseArgs(process.argv.slice(2));

if (argv._.length <= 0) {
  console.error('No path provided')
  process.exit(1)
}

const steamLibPath = normalize(argv._[0])
const steamCommonPath = join(steamLibPath, 'steamapps', 'common')
const applicationPath = join(process.env['HOME'], '.local', 'share', 'applications', 'steam')
const iconPath = join(process.env['HOME'], '.local', 'share', 'icons')
const tmpDir = await mkdtemp(join(tmpdir(), "sdfg-"));
const steamcmdRegex = /^\s*"clienticon"\s+"([^"]+)"\s*$/gm
const steamIconBase = "https://shared.fastly.steamstatic.com/community_assets/images/apps/"

async function extractIco(src, dest) {
  await mkdir(sizesDest);
  return await Promise((resolve, reject) => {
    exec(`icotool -x ${src} -o ${dest}`, (error, stdout, stderror) => {
      if (error) {
        console.error(`Could not extract icon sizes! ${stderror}`);
        reject(error);
        return;
      }
      resolve(stdout)
    });
  });
}

async function downloadIcon(app_id) {
  const iconHash = await getIconHash(app_id);

  if (!iconHash)
    return null;

  const url = `${steamIconBase}${app_id}/${iconHash}.ico`;

  console.log(url);
  const res = await fetch(url);
  if (res.ok) {
    const dest = join(tmpDir, iconHash)
    const fileStream = createWriteStream(dest, { flags: 'wx' });
    await finished(Readable.fromWeb(res.body).pipe(fileStream));
    return dest;
  }

  console.error(`Could not fetch icon! ${await res.text()}`)
  return null;
}

async function getIconHash(app_id) {
  const command = spawn("steamcmd", ['+login', 'anonymous',
    '+app_info_print', app_id, '+quit']);

  const promise = new Promise((resolve, reject) => {
    command.stdout.on('data', output => {
      const searched = steamcmdRegex.exec(output.toString());
      if (searched) {
        resolve(searched[1])
      }
    })

    command.on('close', (code) => {
      if (code) {
        reject(code);
      }
    });
  });

  return await promise.then(
    (hash) => {
      console.log(hash);
      return hash;
    },
    (err) => {
      console.error("Could not use SteamCMD to get icon hash!");
      return null;
    }
  );
}

async function installIcon(app_id) {
  const ico = await downloadIcon(app_id);
  const sizes = await extractIco(ico, join(tmpDir, `${app_id}/`));
}

async function createDesktopFile(dir) {
  const gamePath = join(steamCommonPath, dir)

  try {
    const stats = await stat(gamePath) // Check existence of game directory
    if (!stats.isDirectory()) return // Skip files

    const appidFilePath = join(gamePath, 'steam_appid.txt')

    try {
      if (!existsSync(appidFilePath))
        return

      const fd = await readFile(appidFilePath, 'utf8') // Get the appid
      const game = {
        name: dir,
        id: fd.split('\n')[0]
      }

      await installIcon(game.id);

      const desktopFileContent = `[Desktop Entry]\nName=${game.name}\nComment=Play this game on Steam\nExec=steam steam://rungameid/${game.id}\nIcon=steam\nTerminal=false\nType=Application\nCategories=Game;\n\n`

      try {
        await writeFile(join(applicationPath, `${game.name}.desktop`), desktopFileContent) // Create a .desktop file for the game
        console.log(`Created .desktop file for '${game.name}' (${game.id}).`)
      } catch (error) {
        console.error(error);
      }
    } catch (error) {
      console.error(error);
    }
  } catch (error) {
    console.error(error);
  }
}

async function createAllDesktops() {
  if (!existsSync(steamCommonPath)) {
    console.error('Invalid path.')
    process.exit(1)
  }

  try { // Get all directories in steamCommonPath
    const files = await readdir(steamCommonPath);
    console.log(`Found ${files.length} games.`)
    console.log(`Creating .desktop files...`)
    files.map(async (file) => {
      await createDesktopFile(file)
    })
  } catch (err) {
    console.error(err);
  }
}

await createAllDesktops()
//await rmdir(tmpDir)
