#!/usr/bin/env node
/**
 * Hue Command Line Interface
 *
 * Author: Dave Eddy <dave@daveeddy.com>
 * Date: 3/14/13
 * License: MIT
 */
import fs from "fs";
import path from "path";
import pkg from "./package.json" with { type: "json" };
import csscolors from "css-color-names" with { type: "json" };
import deepmerge from "deepmerge";
import getopt from "posix-getopt";
import Hue from "hue.js";
import { sprintf } from "extsprintf";

function printf() {
  console.log(sprintf.apply(this, arguments));
}

const homedir =
  process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE;
const defaultconfigfile = path.join(homedir, ".hue.json");
const app = "node-hue-cli";

/**
 * return the usage statement
 */
function usage() {
  return [
    "Usage: hue [-c config] [-H host] [--json] [command]",
    "",
    "control philips hue over the command line",
    "",
    "examples",
    "  hue config                  # view the hue config",
    "  hue lights                  # get a list of lights",
    "  hue lights 5                # get information about light 5",
    "  hue lights 5,6,7 on         # turn lights 5 6 and 7 on",
    "  hue lights on               # turn all lights on",
    "  hue lights 1 ff0000         # turn light 1 red",
    "  hue lights 1 red            # same as above",
    "  hue lights 1 +10            # increase the brightness by 10 (out of 254)",
    "  hue lights 1 -10            # decrease the brightness by 10 (out of 254)",
    "  hue lights 1 =100           # set the brightness to 100 (out of 254)",
    "  hue lights 1 +10%           # increase the brightness by 10%",
    "  hue lights 1 -10%           # decrease the brightness by 10",
    "  hue lights 1 =100%          # set the brightness to 100%",
    "  hue lights 4,5 colorloop    # enable the colorloop effect on lights 4 and 5",
    "  hue lights 4,5 alert        # blink lights 4 and 5 for 30 seconds",
    "  hue lights 4,5 clear        # clear any effects on lights 4 and 5",
    "  hue lights 1 state          # set the state on light 1 as passed in as JSON over stdin",
    "  hue rename 1 light-name     # set light 1's name to the given string",
    "  hue lights reset            # Reset lamps to default (on, as if just switched)",
    "  hue lights 1,2 reset        # reset just bulbs 1 and 2",
    "  hue help                    # this message",
    "  hue register                # register this app to hue",
    "  hue search                  # search for hue base stations",
    "  hue alias                   # shows all the defined aliases",
    "  hue alias bedroom 8,9,10    # creates an alias allowing `hue lights bedroom on` and so on",
    "",
    "commands",
    "  config, lights, help, register, search",
    "",
    "options",
    "  -c, --config <file>    config file, defaults to ~/.hue.json",
    "  -h, --help             print this message and exit",
    "  -H, --host             the hostname or ip of the bridge to control",
    "  -j, --json             force output to be in json",
    "  -u, --updates          check for available updates",
    "  -v, --version          print the version number and exit",
  ].join("\n");
}

// command line arguments
const options = [
  "c:(config)",
  "h(help)",
  "H:(host)",
  "j(json)",
  "u(updates)",
  "v(version)",
].join("");
const parser = new getopt.BasicParser(options, process.argv);

let option;
let config = {};
let configfile;
let json = false;
while ((option = parser.getopt()) !== undefined) {
  switch (option.option) {
    case "c":
      configfile = option.optarg;
      break;
    case "h":
      console.log(usage());
      process.exit(0);
    case "H":
      config.host = option.optarg;
      break;
    case "j":
      json = true;
      break;
    case "u":
      import("latest").then(({ checkupdate }) => {
        checkupdate(pkg, function (ret, msg) {
          console.log(msg);
        process.exit(ret);
        });
      });
      break;
    case "v":
      console.log(pkg.version);
      process.exit(0);
    default:
      console.error(usage());
      process.exit(1);
  }
}

const args = process.argv.slice(parser.optind());

try {
  let file = configfile || defaultconfigfile;
  configfile = file;
  const readConfig = JSON.parse(fs.readFileSync(file, "utf-8"));
  config = deepmerge(readConfig, config);
} catch (e) {
  if (configfile) {
    console.error(`failed to read config ${configfile}: ${e.message}`);
    process.exit(1);
  }
}

// load in config colors if present
if (config.colors) {
  Object.keys(config.colors).forEach(function (name) {
    csscolors[name] = config.colors[name];
  });
}

// command switch
let client, lights;
switch (args[0]) {
  case "config": // get the config as json
    client = getclient();
    client.config(function (err, data) {
      console.log(JSON.stringify(err || data, null, 2));
    });
    break;
  case "help": // print the help message
    console.log(usage());
    break;
  case "lights":
  case "light":
  case "list": // mess with the lights
    client = getclient();
    getlights(client, function (lights) {
      // if there are no lights specified, return the list of lights
      const keys = Object.keys(lights);
      if (!args[1]) {
        if (json) return console.log(JSON.stringify(lights, null, 2));
        //printf('%4s %s', 'ID', 'NAME');
        keys.forEach(function (key) {
          printf(`${key}, ${lights[key].name}`);
        });
        return;
      }

      // handle shortcuts like `lights off`, `lights all on`
      let l = args[1].split(",");
      switch (l[0]) {
        case "all":
          l = keys;
          break;
        case "on":
          l = keys;
          args[2] = "on";
          break;
        case "off":
          l = keys;
          args[2] = "off";
          break;
        case "colorloop":
          l = keys;
          args[2] = "colorloop";
          break;
        case "alert":
          l = keys;
          args[2] = "alert";
          break;
        case "clear":
          l = keys;
          args[2] = "clear";
          break;
        case "reset":
          l = keys;
          args[2] = "reset";
          break;
        case "state":
          l = keys;
          args[2] = "state";
          break;
        default:
          if (config.alias && config.alias[l]) {
            l = config.alias[l].split(",");
          }
          break;
      }
      // if there is no action specified, return info for all lights
      if (!args[2]) {
        //if (!json) printf('%4s %-5s %s', 'ID', 'STATE', 'NAME');
        l.forEach(function (id) {
          client.light(id, function (err, data) {
            if (data) data.id = id;
            if (json) return console.log(JSON.stringify(err || data, null, 2));
            if (err)
              return printf(
                `${id} "error" ${err.description} (type ${err.type})`);

            printf(
              `${id} ${data.state.on ? "on" : "off"} ${data.state.bri} ${data.name}`);
          });
        });
        return;
      }

      switch (args[2]) {
        case "off":
          l.forEach(function (id) {
            client.off(id, callback(id));
          });
          break;
        case "on":
          l.forEach(function (id) {
            client.on(id, callback(id));
          });
          break;
        case "colorloop":
          l.forEach(function (id) {
            client.state(id, { effect: "colorloop" }, callback(id));
          });
          break;
        case "alert":
          l.forEach(function (id) {
            client.state(id, { alert: "lselect" }, callback(id));
          });
          break;
        case "clear":
          l.forEach(function (id) {
            client.state(id, { effect: "none", alert: "none" }, callback(id));
          });
          break;
        case "reset":
          l.forEach(function (id) {
            client.state(
              id,
              { on: true, bri: 254, effect: "none", alert: "none", ct: 370 },
              callback(id)
            );
          });
          break;
          case "state": // read state from stdin
          try {
            console.log("Reading state data from stdin...");
            const data = JSON.parse(fs.readFileSync("/dev/stdin", "utf-8"));
            console.log("State data read from stdin:", data);
            l.forEach(function (id) {
              console.log(`Setting state for light ${id} with data:`, data);
              client.state(id, data, callback(id));
            });
          } catch (e) {
            console.error(`Failed to read or parse state data from stdin: ${e.message}`);
            process.exit(1);
          }
          break;
        default: // hex, colors, or brightness
          const s = args[2];
          let match;

          if ((match = s.match(/^([-+=])([0-9]+)(%?)$/))) {
            const op = match[1];
            const num = match[2];
            const perc = match[3];
            l.forEach(function (id) {
              client.light(id, function (err, data) {
                if (err) {
                  if (json)
                    return console.log(JSON.stringify(err || data, null, 2));
                  return printf(
                    `${id} "error" ${err.description} (type ${err.type})`);
                }
                let bri = data.state.bri;
                let oldbri = bri;
                switch (op) {
                  case "=":
                    if (perc) bri = Math.round(num * (254 / 100));
                    else bri = num;
                    break;
                  case "+":
                    if (perc) bri += Math.round(num * (254 / 100));
                    else bri += num;
                    break;
                  case "-":
                    if (perc) bri -= Math.round(num * (254 / 100));
                    else bri -= num;
                    break;
                }
                bri = Math.min(254, Math.max(1, bri));
                client.state(id, { bri: bri }, function (err, data) {
                  if (json)
                    return console.log(JSON.stringify(err || data, null, 2));
                  if (err)
                    return printf(
                      `${id} "error" ${err.description} (type ${err.type})`);
                      client.lights(function (err, lights) {
                      let lightName = lights[id] ? lights[id].name : `light ${id}`;
                      console.log(`💡 ${lightName} Brightness Updated: ${oldbri} → ${bri}`);
                  });
                });
              });
            });
            return;
          }

          const hex = csscolors[s] || s;
          const rgb = hex2rgb(hex);

          l.forEach(function (id) {
            client.rgb(id, rgb[0], rgb[1], rgb[2], callback(id));
          });
          break;
      }

      function callback(id) {
        return function (err) {
          client.lights(function (err, lights) {
            if (err) throw err;
            let lightName = lights[id] ? lights[id].name : `light ${id}`;
            let lightState = lights[id] ? lights[id].state : `light ${id}`;
            if (json) return console.log(JSON.stringify(err || null, 2));
            if (err) return console.error(`${lightName} failed: ${err.description}`);
            if(args[2] === "on" || args[2] === "off") {
              console.log(`${lightState.on ? "💡" : "🌑"} ${lightName} was turned ${lightState.on ? "on" : "off"}`);
            } else if (args[2] === "reset"){
              console.log(`${lightName} reset to default state`);
            } else if (args[2] === "colorloop") {
              console.log(`${lightName} color loop started`);
            } else if (args[2] === "alert") {
              console.log(`${lightName} alert started`);
            } else if (args[2] === "clear") {
              console.log(`${lightName} effects cleared`);
            } else if (args[2] === "state") {
              console.log(`${lightName} state changed`);
            } else {
              console.log(`${lightName} color changed`);
            }
            
          });
        };
      }
    });
    break;
  case "register": // register this app
    // Check for existing config
    const existingconfig = statPath(configfile);
    if (existingconfig && existingconfig.isFile()) {
      console.log(`A config file already exists at ${configfile}`);
      console.log("please remove it before attempting to register a new hub");
      process.exit(1);
    }
    // Attempt to pair with hue hub
    client = getclient();
    console.log("Please go and press the link button on your base station");
    client.register(function (err, resp) {
      if (err) {
        console.error(`failed to pair to Hue Base Station ${config.host}`);
        throw err;
      }

      console.log("Hue Base Station paired!");
      console.log("username: " + resp[0].success.username);
      config.username = resp[0].success.username;

      // writing config file
      const s = JSON.stringify(config, null, 2);
      fs.writeFileSync(configfile, s + "\n");
      console.log(`config file written to ${configfile}`);
    });
    break;
  case "alias":
    config.alias = config.alias || {};
    if (args.length === 1) {
      console.log(JSON.stringify(config.alias, null, 2));
    } else if (args.length == 3) {
      config.alias[args[1]] = args[2];
      // writing config file
      const s = JSON.stringify(config, null, 2);
      fs.writeFileSync(configfile, s + "\n");
      console.log(`config in ${configfile} updated`);
    } else {
      console.error("wrong usage of alias, run `hue help`");
      process.exit(1);
    }
    break;
  case "search": // search for base stations
    Hue.discover(function (stations) {
      if (json) return console.log(JSON.stringify(stations, null, 2));
      if (stations.length === 0) {
        console.log("No stations found. Check your network connection.");
      } else if (stations.length === 1) {
        console.log(`1 station found: ${stations[0]}`);
      } else {
        console.log(`${stations.length} stations found: \n`);
        stations.forEach(function (name, i) {
        console.log(`${i + 1}: ${name}`);
      });
      }
    });
    break;
  case "rename": // rename light
    client = getclient();
    client.rename(args[1], args[2], function (reply) {
      if (reply) {
        console.log(`problem renaming light: ${reply.description}`);
      } else {
        console.log(`light ${args[1]} renamed`);
      }
    });
    break;
  default: // uh oh
    console.error("unknown command: run `hue help` for more information");
    process.exit(1);
}

// wrapper around get client to error on failure
function getclient() {
  if (!config.host) {
    console.error(
      [
        "error: host not set",
        "",
        "search for hosts with `hue search`",
        "then run with `-H <host>`",
      ].join("\n")
    );
    process.exit(1);
  }

  // create the client
  const client = Hue.createClient({
    stationIp: config.host,
    appName: app,
    username: config.username,
  });
  return client;
}

// wrapper around get lights to error on failure
function getlights(client, cb) {
  // checking for lights will also help us ensure the app is registered
  // from exmample here https://github.com/thatguydan/hue.js
  client.lights(function (err, lights) {
    if (err && err.type === 1) {
      console.error(
        "error: application not registered, run `hue register` first"
      );
      process.exit(1);
    }
    if (err) { 
      console.info(`Service unavailable. Please try again later.`);
      process.exit(1);
    }
    cb(lights);
  });
}

// convert a 3 or 6 character hex string to rgb
function hex2rgb(hex) {
  if (hex[0] === "#") hex = hex.slice(1);
  let r, g, b;

  if (hex.length === 3) {
    r = todec(hex[0], hex[0]);
    g = todec(hex[1], hex[1]);
    b = todec(hex[2], hex[2]);
  } else {
    r = todec(hex[0], hex[1]);
    g = todec(hex[2], hex[3]);
    b = todec(hex[4], hex[5]);
  }

  return [r, g, b];

  function todec(h, i) {
    return parseInt(h + "" + i, 16);
  }
}

function statPath(path) {
  try {
    return fs.statSync(path);
  } catch (ex) {}
  return false;
}
