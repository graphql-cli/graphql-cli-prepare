import chalk from 'chalk'
import * as fs from 'fs-extra'
import { Context } from 'graphql-cli'
import { GraphQLConfig, GraphQLProjectConfig } from 'graphql-config'
import { importSchema } from 'graphql-import'
import { generateCode } from 'graphql-static-binding'
import { get, has, merge } from 'lodash'
import * as path from 'path'
import { Arguments } from 'yargs'

export class Prepare {
  private config: GraphQLConfig
  private bundleExtensionConfig: { 'prepare-bundle': string } | undefined
  private projectName: string
  private project: GraphQLProjectConfig
  private projectDisplayName = () => chalk.green(this.projectName)

  constructor(private context: Context, private argv: Arguments) {}

  async handle() {
    this.config = await this.context.getConfig()

    // Get projects
    const projects: { [name: string]: GraphQLProjectConfig } = this.getProjectConfig()

    // Process each project
    for (const projectName of Object.keys(projects)) {
      const project: GraphQLProjectConfig = projects[projectName]

      this.setCurrentProject(project, projectName)
      if (this.argv.bundle) {
        this.bundle()
      }
      if (this.argv.bindings) {
        this.bindings()
      }
      this.save()
    }
  }

  setCurrentProject(project: GraphQLProjectConfig, projectName: string): void {
    this.project = project
    this.projectName = projectName
    this.bundleExtensionConfig = undefined
  }

  bindings() {
    let bindingExtensionConfig: { 'prepare-binding': { output: string; generator: string } } | undefined

    if (
      this.argv.project ||
      (!this.argv.project &&
        (has(this.project.config, 'extensions.prepare-binding') ||
          has(this.project.config, 'extensions.binding')))
    ) {
      this.context.spinner.start(`Generating bindings for project ${this.projectDisplayName()}...`)
      bindingExtensionConfig = this.processBindings(
        this.bundleExtensionConfig ? this.bundleExtensionConfig['prepare-bundle'] : undefined
      )
      merge(this.project.extensions, bindingExtensionConfig)
      this.context.spinner.succeed(
        `Bindings for project ${this.projectDisplayName()} written to ${chalk.green(
          bindingExtensionConfig['prepare-binding'].output
        )}`
      )
    } else if (this.argv.verbose) {
      this.context.spinner.info(
        `Binding not configured for project ${this.projectDisplayName()}. Skipping`
      )
    }
  }

  bundle() {
    if (
      this.argv.project ||
      (!this.argv.project &&
        (has(this.project.config, 'extensions.prepare-bundle') ||
          has(this.project.config, 'extensions.bundle')))
    ) {
      this.context.spinner.start(`Processing schema imports for project ${this.projectDisplayName()}...`)
      this.bundleExtensionConfig = this.processBundle()
      merge(this.project.extensions, this.bundleExtensionConfig)
      this.context.spinner.succeed(
        `Bundled schema for project ${this.projectDisplayName()} written to ${chalk.green(
          this.bundleExtensionConfig['prepare-bundle']
        )}`
      )
    } else if (this.argv.verbose) {
      this.context.spinner.info(
        `Bundling not configured for project ${this.projectDisplayName()}. Skipping`
      )
    }
  }

  save() {
    if (this.argv.save) {
      const configFile = path.basename(this.config.configPath)
      this.context.spinner.start(
        `Saving configuration for project ${this.projectDisplayName()} to ${chalk.green(configFile)}...`
      )
      this.saveConfig()
      this.context.spinner.succeed(
        `Configuration for project ${this.projectDisplayName()} saved to ${chalk.green(configFile)}`
      )
    }
  }

  getProjectConfig(): { [name: string]: GraphQLProjectConfig } {
    let projects: { [name: string]: GraphQLProjectConfig } | undefined
    if (this.argv.project) {
      if (Array.isArray(this.argv.project)) {
        projects = {}
        this.argv.project.map((p: string) => merge(projects, { [p]: this.config.getProjectConfig(p) }))
      } else {
        // Single project mode
        projects = { [this.argv.project]: this.config.getProjectConfig(this.argv.project) }
      }
    } else {
      // Process all projects
      projects = this.config.getProjects()
    }

    if (!projects) {
      throw new Error('No projects defined in config file')
    }

    return projects
  }

  processBundle(): { 'prepare-bundle': string } {
    const outputPath: string = this.determineBundleOutputPath()
    const schemaPath: string = this.determineSchemaPath()

    const finalSchema = importSchema(schemaPath)

    fs.writeFileSync(outputPath, finalSchema, { flag: 'w' })

    return { 'prepare-bundle': outputPath }
  }

  processBindings(
    schemaPath: string | undefined
  ): { 'prepare-binding': { output: string; generator: string } } {
    const generator: string = this.determineGenerator()
    // TODO: This does not support custom generators
    const extension = generator.endsWith('ts') ? 'ts' : 'js'
    const outputPath: string = this.determineBindingOutputPath(extension)
    const schema: string = this.determineInputSchema(schemaPath)

    const schemaContents: string = fs.readFileSync(schema, 'utf-8')
    const finalSchema: string = generateCode(schemaContents, generator)
    fs.writeFileSync(outputPath, finalSchema, { flag: 'w' })

    return { 'prepare-binding': { output: outputPath, generator: generator } }
  }

  saveConfig() {
    if (has(this.project.config, 'extensions.bundle')) {
      delete this.project.config.extensions!.bundle
    }
    if (has(this.project.config, 'extensions.binding')) {
      delete this.project.config.extensions!.binding
    }
    this.config.saveConfig(this.project.config, this.projectName)
  }

  /**
   * Determine input schema path for binding. It uses the resulting schema from bundling (if available),
   * then looks at bundle extension (in case bundling ran before), then takes the project schemaPath.
   * Also checks if the file exists, otherwise it throws and error.
   *
   * @param {(string | undefined)} schemaPath Schema path from bundling
   * @returns {string} Input schema path to be used for binding generatio.
   */
  determineInputSchema(schemaPath: string | undefined): string {
    const bundleDefined = has(this.project.config, 'extensions.prepare-bundle.output')
    const oldBundleDefined = has(this.project.config, 'extensions.bundle.output')
    // schemaPath is only set when bundle ran
    if (!schemaPath) {
      if (bundleDefined) {
        // Otherwise, use bundle output schema if defined
        schemaPath = get(this.project.config, 'extensions.prepare-bundle.output')
      } else if (oldBundleDefined) {
        schemaPath = get(this.project.config, 'extensions.bundle.output')
      } else if (this.project.schemaPath) {
        // Otherwise, use project schemaPath
        schemaPath = this.project.schemaPath
      } else {
        throw new Error(`Input schema cannot be determined.`)
      }
    }

    if (fs.existsSync(schemaPath!)) {
      return schemaPath!
    } else {
      throw new Error(
        `Schema '${schemaPath!}' not found.${bundleDefined ? ' Did you run bundle first?' : ''}`
      )
    }
  }

  /**
   * Determine input schema path for bundling.
   *
   * @returns {string} Input schema path for bundling
   */
  determineSchemaPath(): string {
    if (this.project.schemaPath) {
      return this.project.schemaPath
    }
    throw new Error(`No schemaPath defined for project '${this.projectName}' in config file.`)
  }

  /**
   * Determine generator. Provided generator takes precedence over value from config
   *
   * @param {string} generator Command line parameter for generator
   * @returns {string} Generator to be used
   */
  determineGenerator(): string {
    if (this.argv.generator) {
      return this.argv.generator
    }
    if (has(this.project.config, 'extensions.binding.generator')) {
      if (!this.argv.save) {
        this.context.spinner.warn(
          `Deprecated extension key 'binding.generator' found in config file. Use '--save' to update to 'prepare-binding.generator'.`
        )
      }
      return get(this.project.config, 'extensions.binding.generator')
    }
    if (has(this.project.config, 'extensions.prepare-binding.generator')) {
      return get(this.project.config, 'extensions.prepare-binding.generator')
    }
    throw new Error(
      'Generator cannot be determined. No existing configuration found and no generator parameter specified.'
    )
  }

  /**
   * Determine output path for binding. Provided path takes precedence over value from config
   *
   * @param {string} extension File extension for output file
   * @returns Output path
   */
  determineBindingOutputPath(extension: string) {
    let outputPath: string
    if (this.argv.output) {
      outputPath = path.join(this.argv.output, `${this.projectName}.${extension}`)
    } else if (has(this.project.config, `extensions.binding.output`)) {
      if (!this.argv.save) {
        this.context.spinner.warn(
          `Deprecated extension key 'binding.output' found in config file. Use '--save' to update to 'prepare-binding.output'.`
        )
      }
      outputPath = get(this.project.config, `extensions.binding.output`)
    } else if (has(this.project.config, `extensions.prepare-binding.output`)) {
      outputPath = get(this.project.config, `extensions.prepare-binding.output`)
    } else {
      throw new Error(
        'Output path cannot be determined. No existing configuration found and no output parameter specified.'
      )
    }

    fs.ensureDirSync(path.dirname(outputPath))
    return outputPath
  }

  /**
   * Determine output path for bundle. Provided path takes precedence over value from config
   *
   * @returns Output path
   */
  determineBundleOutputPath() {
    let outputPath: string
    if (this.argv.output) {
      outputPath = path.join(this.argv.output, `${this.projectName}.graphql`)
    } else if (has(this.project.config, `extensions.bundle`)) {
      if (!this.argv.save) {
        this.context.spinner.warn(
          `Deprecated extension key 'bundle' found in config file. Use '--save' to update to 'prepare-bundle'.`
        )
      }
      outputPath = get(this.project.config, `extensions.bundle`)
    } else if (has(this.project.config, `extensions.prepare-bundle`)) {
      outputPath = get(this.project.config, `extensions.prepare-bundle`)
    } else {
      throw new Error(
        'Output path cannot be determined. No existing configuration found and no output parameter specified.'
      )
    }

    fs.ensureDirSync(path.dirname(outputPath))
    return outputPath
  }
}
