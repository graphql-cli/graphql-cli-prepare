import * as fs from 'fs'
import { Context } from 'graphql-cli'
import { GraphQLProjectConfig } from 'graphql-config'
import { importSchema } from 'graphql-import'
import { generateCode } from 'graphql-static-binding'
import { get, has, merge } from 'lodash'
import * as path from 'path'

export function getProjectConfig(
  project: string,
  context: Context
): { [name: string]: GraphQLProjectConfig } {
  let projects: { [name: string]: GraphQLProjectConfig } | undefined
  if (project) {
    if (Array.isArray(project)) {
      projects = {}
      project.map((p: string) => merge(projects, { [p]: context.getConfig().getProjectConfig(p) }))
    } else {
      // Single project mode
      projects = { [project]: context.getProjectConfig() }
    }
  } else {
    // Process all projects
    projects = context.getConfig().getProjects()
  }

  if (!projects) {
    throw new Error('No projects defined in config file')
  }

  return projects
}

export function processBundle(
  projectName: string,
  project: GraphQLProjectConfig,
  args: { output: string }
): { bundle: string } {
  const outputPath: string = determineOutputPath(projectName, project, args.output, 'graphql', 'bundle')
  const schemaPath: string = determineSchemaPath(projectName, project)

  const finalSchema = importSchema(schemaPath)

  fs.writeFileSync(outputPath, finalSchema, { flag: 'w' })

  return { bundle: outputPath }
}

export function processBindings(
  projectName: string,
  project: GraphQLProjectConfig,
  args: { output: string; generator: string; schemaPath: string | undefined }
): { binding: { output: string, generator: string } } {
  const generator: string = determineGenerator(project, args.generator)
  // TODO: This does not support custom generators
  const extension = generator.endsWith('ts') ? 'ts' : 'js'
  const outputPath: string = determineOutputPath(
    projectName,
    project,
    args.output,
    extension,
    'binding.output'
  )
  const schema: string = determineInputSchema(args.schemaPath, project)

  const schemaContents: string = fs.readFileSync(schema, 'utf-8')
  const finalSchema: string = generateCode(schemaContents, generator)
  fs.writeFileSync(outputPath, finalSchema, { flag: 'w' })

  return { binding: { output: outputPath, generator } }
}

export function saveConfig(context, project, projectName) {
  const config = context.getConfig()
  config.saveConfig(project.config, projectName)
}

/**
 * Determine input schema path for binding. It uses the resulting schema from bundling (if available),
 * then looks at bundle extension (in case bundling ran before), then takes the project schemaPath.
 * Also checks if the file exists, otherwise it throws and error.
 *
 * @param {(string | undefined)} schemaPath Schema path from bundling
 * @param {GraphQLProjectConfig} project Configuration object for current project
 * @returns {string} Input schema path to be used for binding generatio.
 */
function determineInputSchema(schemaPath: string | undefined, project: GraphQLProjectConfig): string {
  const bundleDefined = has(project.config, 'extensions.bundle.output')
  // schemaPath is only set when bundle ran
  if (!schemaPath) {
    if (bundleDefined) {
      // Otherwise, use bundle output schema if defined
      schemaPath = get(project.config, 'extensions.bundle.output')
    } else if (project.schemaPath) {
      // Otherwise, use project schemaPath
      schemaPath = project.schemaPath
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
 * @param {string} projectName Name of the current project
 * @param {GraphQLProjectConfig} project Configuration object for current project
 * @returns {string} Input schema path for bundling
 */
function determineSchemaPath(projectName: string, project: GraphQLProjectConfig): string {
  if (project.schemaPath) {
    return project.schemaPath
  }
  throw new Error(`No schemaPath defined for project '${projectName}' in config file.`)
}

/**
 * Determine generator. Provided generator takes precedence over value from config
 *
 * @param {GraphQLProjectConfig} project Configuration object for current project
 * @param {string} generator Command line parameter for generator
 * @returns {string} Generator to be used
 */
function determineGenerator(project: GraphQLProjectConfig, generator: string): string {
  if (generator) {
    return generator
  }
  if (has(project.config, 'extensions.binding.generator')) {
    return get(project.config, 'extensions.binding.generator')
  }
  throw new Error(
    'Generator cannot be determined. No existing configuration found and no generator parameter specified.'
  )
}

/**
 * Determine output path. Provided path takes precedence over value from config
 *
 * @param {GraphQLProjectConfig} project Configuration object for current project
 * @param {string} output Command line parameter for output path
 * @param {string} key Extension key containing current output setting
 * @returns Output path
 */
function determineOutputPath(
  projectName: string,
  project: GraphQLProjectConfig,
  output: string,
  extension: string,
  key: string
) {
  let outputPath: string
  if (output) {
    outputPath = path.join(output, `${projectName}.${extension}`)
  } else if (has(project.config, `extensions.${key}`)) {
    outputPath = get(project.config, `extensions.${key}`)
  } else {
    throw new Error(
      'Output path cannot be determined. No existing configuration found and no output parameter specified.'
    )
  }

  if (!fs.existsSync(path.dirname(outputPath))) {
    throw new Error(`Output path '${path.dirname(outputPath)}' does not exist.`)
  }
  return outputPath
}
