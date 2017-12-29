import { defineSupportCode, TableDefinition } from 'cucumber'
import { handler } from '../../src'

defineSupportCode(({ Given, When, Then}) => {
    Given('I provide the following parameters', (table: TableDefinition) => {
        const params = table.rowsHash()
        console.log('nothing happened')
    })
    
    When('I run the command', () => {
        try{
            handler({prompt: null, spinner: null, getProjectConfig: null, getConfig: null}, { bundle: true, bindings: true})
        } catch {}
    })
    
    Then('it should work', () => {
        console.log('then')
    })
})
