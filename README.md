# Packpack

Packpack is a tool to bundle your application along side with its dependencies inside one archive.
By default it will include only:

- What is defined inside the `files` entry (see [here for more info](https://docs.npmjs.com/files/package.json#files))
- All of the `dependencies` defined inside the package.json (no devDependencies)
- All of the `dependencies` defined inside each `bundleDependenciesOf` entries

# License

Apache-2.0