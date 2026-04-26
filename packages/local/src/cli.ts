#!/usr/bin/env node
import { buildCli } from "./index.js";

buildCli().parse(process.argv);
