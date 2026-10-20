<p align="center">
   <a href="https://github.com/homebridge-plugins/homebridge-ecovacs"><img alt="homebridge-ecovacs" src="https://raw.githubusercontent.com/homebridge-plugins/homebridge-ecovacs/latest/branding/Homebridge_x_Ecovacs.png" width="600px"></a>
</p>
<span align="center">

## homebridge-ecovacs

Homebridge plugin to integrate Ecovacs Deebot or Yeedi devices into HomeKit

[![npm](https://img.shields.io/npm/v/@homebridge-plugins/homebridge-ecovacs/latest?label=latest)](https://www.npmjs.com/package/@homebridge-plugins/homebridge-ecovacs)
[![npm](https://img.shields.io/npm/v/@homebridge-plugins/homebridge-ecovacs/beta?label=beta)](https://github.com/homebridge-plugins/homebridge-ecovacs/wiki/Beta-Version)<br>
[![verified-by-homebridge](https://img.shields.io/badge/homebridge-verified-blueviolet?color=%23491F59&style=flat)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![hoobs-certified](https://img.shields.io/badge/hoobs-certified-yellow)](https://plugins.hoobs.org/plugin/homebridge-ecovacs)<br>
[![npm](https://img.shields.io/npm/dt/@homebridge-plugins/homebridge-ecovacs)](https://www.npmjs.com/package/@homebridge-plugins/homebridge-ecovacs)
[![Discord](https://img.shields.io/discord/432663330281226270?color=728ED5&logo=discord&label=hb-discord)](https://discord.com/channels/432663330281226270/742733745743855627)

</span>

> [!NOTE]
> **This is a fork** of [homebridge-plugins/homebridge-ecovacs](https://github.com/homebridge-plugins/homebridge-ecovacs), published as `@luckyraja/homebridge-yeedim14p` so Homebridge never replaces it with an upstream update. It adds full Matter support for the **Yeedi M14 Plus** (device class `6801mm`), which the upstream plugin can see but not properly control:
>
> - status from the robot's work state - cleaning, paused, returning, charging, and the station emptying the bin or washing the mop
> - pause, resume and return to dock, using the commands this robot obeys
> - clean modes Vacuum & Mop / Vacuum / Mop / Mop after Vacuum
> - cleaning selected rooms of the current map
> - specific errors such as a full dirty water tank
>
> Other devices behave exactly as upstream. The badges and wiki links below are the upstream plugin's.
>
> **Personal fork, maintained for my own use only - no support, no issues, and no npm releases.** You are welcome to use or copy it under the MIT licence, but for anything else please use the [upstream plugin](https://github.com/homebridge-plugins/homebridge-ecovacs).

### Plugin Information

- This plugin allows you to view and control your Ecovacs or Yeedi devices within HomeKit. The plugin:
  - requires your Ecovacs or Yeedi credentials to function
  - uses a cloud-based connection (i.e. requires the internet)

### Prerequisites

- To use this plugin, you will need to already have:
  - [Node](https://nodejs.org): latest version of `v22`, `v24` or `v26` - any other major version is not supported.
  - [Homebridge](https://homebridge.io): `v2.0` or above - refer to link for more information and installation instructions.

### Setup

- [Installation](https://github.com/homebridge-plugins/homebridge-ecovacs/wiki/Installation)
- [Configuration](https://github.com/homebridge-plugins/homebridge-ecovacs/wiki/Configuration)
- [Beta Version](https://github.com/homebridge-plugins/homebridge-ecovacs/wiki/Beta-Version)
- [Node Version](https://github.com/homebridge-plugins/homebridge-ecovacs/wiki/Node-Version)

### Features

- [Supported Devices](https://github.com/homebridge-plugins/homebridge-ecovacs/wiki/Supported-Devices)
- [Speed Control](https://github.com/homebridge-plugins/homebridge-ecovacs/wiki/Speed-Control)
- [Predefined Areas](https://github.com/homebridge-plugins/homebridge-ecovacs/wiki/Predefined-Areas)

### Help/About

- [Common Errors](https://github.com/homebridge-plugins/homebridge-ecovacs/wiki/Common-Errors)
- [Support Request](https://github.com/homebridge-plugins/homebridge-ecovacs/issues/new/choose)
- [Changelog](https://github.com/homebridge-plugins/homebridge-ecovacs/blob/latest/CHANGELOG.md)
- [About Me](https://github.com/sponsors/bwp91)

### Credits

- To the owner of [ecovacs-deebot.js](https://github.com/mrbungle64/ecovacs-deebot.js) client: [@mrbungle64](https://github.com/mrbungle64).
- To the owner of [homebridge-deebotEcovacs](https://github.com/nicoduj/homebridge-deebotEcovacs): [@nicoduj](https://github.com/nicoduj).
- To the creator of the awesome plugin header logo: [Keryan Belahcene](https://www.instagram.com/keryan.me).
- To the creators/contributors of [Homebridge](https://homebridge.io) who make this plugin possible.

### Disclaimer

- I am in no way affiliated with Ecovacs/Deebot/Yeedi and this plugin is a personal project that I maintain in my free time.
- Use this plugin entirely at your own risk - please see licence for more information.
