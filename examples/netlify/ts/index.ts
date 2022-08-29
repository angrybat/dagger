import { client, DaggerServer, gql, FSID, SecretID } from "@dagger.io/dagger";
import { getSdk } from "./gen/core/core.js";
const core = getSdk(client);

import { NetlifyAPI } from "netlify";
import { execa } from "execa";

import * as path from "path";

const resolvers = {
  Netlify: {
    deploy: async (args: {
      contents: FSID;
      subdir: string;
      siteName: string;
      token: SecretID;
    }) => {
      // TODO: should be set from Dockerfile ENV, just not propagated by dagger server yet
      process.env["PATH"] = "/app/src/node_modules/.bin:" + process.env["PATH"];
      process.env["HOME"] = "/tmp";

      const token = await core
        .Secret({ id: args.token })
        .then((res) => res.core.secret);
      process.env["NETLIFY_AUTH_TOKEN"] = token;

      const netlifyClient = new NetlifyAPI(token);

      // filter the input site name out from the list of sites
      var site = await netlifyClient
        .listSites()
        .then((sites: Array<any>) =>
          sites.find((site: any) => site.name === args.siteName)
        );
      if (site === undefined) {
        var site = await netlifyClient.createSite({
          body: {
            name: args.siteName,
          },
        });
      }

      const srcDir = path.join("/mnt/contents", args.subdir);

      await execa("netlify", ["link", "--id", site.id], {
        stdout: "inherit",
        stderr: "inherit",
        cwd: srcDir,
      });

      await execa(
        "netlify",
        ["deploy", "--build", "--site", site.id, "--prod"],
        {
          stdout: "inherit",
          stderr: "inherit",
          cwd: srcDir,
        }
      );

      site = await netlifyClient.getSite({ site_id: site.id });
      return {
        url: site.url,
        deployURL: site.deploy_url,
      };
    },
  },
  Filesystem: {
    netlifyDeploy: async (
      args: {
        subdir: string;
        siteName: string;
        token: SecretID;
      },
      parent: { id: FSID }
    ) => {
      return resolvers.Netlify.deploy({
        contents: parent.id,
        subdir: args.subdir,
        siteName: args.siteName,
        token: args.token,
      });
    },
  },
};

const server = new DaggerServer({ resolvers });

server.run();
