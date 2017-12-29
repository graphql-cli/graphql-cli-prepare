import { Context, CommandObject } from 'graphql-cli' // Types only
import { CommandModule } from 'yargs' // Types only
import { GraphQLProjectConfig } from 'graphql-config' // Types only

import chalk from 'chalk'
import { has, merge } from 'lodash'
import * as path from 'path'

import { getProjectConfig, processBundle, processBindings, saveConfig } from './prepare'

const command: CommandObject = {
  command: 'prepare',
  describe: 'Bundle schemas and generate bindings',

  builder: argv => {
    return argv.options({
      output: {
        alias: 'o',
        describe: 'Output folder',
        type: 'string'
      },
      save: {
        alias: 's',
        describe: 'Save settings to config file',
        type: 'boolean',
        default: 'false'
      },
      bundle: {
        describe: 'Process schema imports',
        type: 'boolean',
        default: 'false'
      },
      bindings: {
        describe: 'Generate bindings',
        type: 'boolean',
        default: 'false'
      },
      generator: {
        alias: 'g',
        describe: 'Generator used to generate bindings',
        type: 'string'
      }
    })
  },

  handler: (context: Context, argv) => {
    if (!argv.bundle && !argv.bindings) {
      argv.bundle = argv.bindings = true
    }

    // Get projects
    const projects: { [name: string]: GraphQLProjectConfig } = getProjectConfig(argv.project, context)

    // Process each project
    for (const projectName of Object.keys(projects)) {
      const project = projects[projectName]

      let bundleExtensionConfig: { bundle: string } | undefined
      let bindingExtensionConfig: { binding: { output: string, generator: string } } | undefined

      if (argv.bundle) {
        if (argv.project || (!argv.project && has(project.config, 'extensions.bundle'))) {
          context.spinner.start(`Processing schema imports for project ${chalk.green(projectName)}...`)
          bundleExtensionConfig = processBundle(projectName, project, { output: argv.output })
          merge(project.extensions, bundleExtensionConfig)
          context.spinner.succeed(
            `Bundled schema for project ${chalk.green(projectName)} written to ${chalk.green(
              bundleExtensionConfig.bundle
            )}`
          )
        } else {
          context.spinner.info(`Bundling not configured for project ${chalk.green(projectName)}. Skipping`)
        }
      }

      if (argv.bindings) {
        if (argv.project || (!argv.project && has(project.config, 'extensions.binding'))) {
          context.spinner.start(`Generating bindings for project ${chalk.green(projectName)}...`)
          bindingExtensionConfig = processBindings(projectName, project, {
            output: argv.output,
            generator: argv.generator,
            schemaPath: bundleExtensionConfig ? bundleExtensionConfig.bundle : undefined
          })
          merge(project.extensions, bindingExtensionConfig)
          context.spinner.succeed(
            `Bindings for project ${chalk.green(projectName)} written to ${chalk.green(bindingExtensionConfig.binding.output)}`
          )
        } else {
          context.spinner.info(`Binding not configured for project ${chalk.green(projectName)}. Skipping`)
        }
      }

      if (argv.save) {
        context.spinner.start(`Saving configuration for project ${chalk.green(projectName)} to ${chalk.green(path.basename(context.getConfig().configPath))}...`)
        saveConfig(context, project, projectName)
        context.spinner.succeed(`Configuration for project ${chalk.green(projectName)} saved to ${chalk.green(path.basename(context.getConfig().configPath))}`)
      }
    }
  }
}

export = command
