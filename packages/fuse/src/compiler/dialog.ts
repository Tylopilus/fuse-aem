import { FieldJson } from './expr.js';
import { SchemaJson } from './template.js';
import { xmlAttr } from './util.js';

export function generateComponentContentXml(schema: SchemaJson): string {
  const title = xmlAttr(schema.title);
  const group = schema.group ? `    componentGroup="${xmlAttr(schema.group)}"\n` : '';
  const desc = schema.description ? `    jcr:description="${xmlAttr(schema.description)}"\n` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0"
    xmlns:cq="http://www.day.com/jcr/cq/1.0"
    xmlns:jcr="http://www.jcp.org/jcr/1.0"
    jcr:primaryType="cq:Component"
    jcr:title="${title}"
${group}${desc}/>
`;
}

export function generateDialogXml(schema: SchemaJson): string {
  const title = xmlAttr(schema.title);
  const fieldsXml = (Object.entries(schema.fields) as [string, FieldJson][])
    .map(([name, field]) => renderField(name, field, './' + name, 10))
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0"
    xmlns:granite="http://www.adobe.com/jcr/granite/1.0"
    xmlns:cq="http://www.day.com/jcr/cq/1.0"
    xmlns:jcr="http://www.jcp.org/jcr/1.0"
    xmlns:nt="http://www.jcp.org/jcr/nt/1.0"
    jcr:primaryType="nt:unstructured"
    jcr:title="${title}"
    sling:resourceType="cq/gui/components/authoring/dialog">
    <items jcr:primaryType="nt:unstructured">
        <tabs jcr:primaryType="nt:unstructured"
            sling:resourceType="granite/ui/components/coral/foundation/tabs"
            maximized="{Boolean}true">
            <items jcr:primaryType="nt:unstructured">
                <properties jcr:primaryType="nt:unstructured"
                    jcr:title="Properties"
                    sling:resourceType="granite/ui/components/coral/foundation/container"
                    margin="{Boolean}true">
                    <items jcr:primaryType="nt:unstructured">
                        <columns jcr:primaryType="nt:unstructured"
                            sling:resourceType="granite/ui/components/coral/foundation/fixedcolumns"
                            margin="{Boolean}true">
                            <items jcr:primaryType="nt:unstructured">
                                <column jcr:primaryType="nt:unstructured"
                                    sling:resourceType="granite/ui/components/coral/foundation/container">
                                    <items jcr:primaryType="nt:unstructured">
${fieldsXml}
                                    </items>
                                </column>
                            </items>
                        </columns>
                    </items>
                </properties>
            </items>
        </tabs>
    </items>
</jcr:root>
`;
}

function renderField(nodeName: string, field: FieldJson, propPath: string, indent: number): string {
  const pad = ' '.repeat(indent);
  const label = field.label ? `fieldLabel="${xmlAttr(field.label)}"` : '';
  const desc = field.description ? `fieldDescription="${xmlAttr(field.description)}"` : '';
  const req = field.required ? `required="{Boolean}true"` : '';

  switch (field.kind) {
    case 'text': {
      const max = field.maxLength ? `maxlength="{Long}${field.maxLength}"` : '';
      const def = field.defaultValue != null ? `value="${xmlAttr(String(field.defaultValue))}"` : '';
      const attrs = [
        'jcr:primaryType="nt:unstructured"',
        'sling:resourceType="granite/ui/components/coral/foundation/form/textfield"',
        `name="${xmlAttr(propPath)}"`,
        label,
        desc,
        req,
        max,
        def,
      ].filter(Boolean).join('\n' + pad + '    ');
      return `${pad}<${nodeName} ${attrs}/>`;
    }

    case 'textarea': {
      const attrs = [
        'jcr:primaryType="nt:unstructured"',
        'sling:resourceType="granite/ui/components/coral/foundation/form/textarea"',
        `name="${xmlAttr(propPath)}"`,
        label,
        desc,
        req,
      ].filter(Boolean).join('\n' + pad + '    ');
      return `${pad}<${nodeName} ${attrs}/>`;
    }

    case 'richtext': {
      const attrs = [
        'jcr:primaryType="nt:unstructured"',
        'sling:resourceType="cq/gui/components/authoring/dialog/richtext"',
        `name="${xmlAttr(propPath)}"`,
        label,
        desc,
        'useFixedInlineToolbar="{Boolean}true"',
      ].filter(Boolean).join('\n' + pad + '    ');
      return `${pad}<${nodeName} ${attrs}/>`;
    }

    case 'number': {
      const min = field.min != null ? `min="{Double}${field.min}"` : '';
      const max = field.max != null ? `max="{Double}${field.max}"` : '';
      const step = field.step != null ? `step="{Double}${field.step}"` : '';
      const def = field.defaultValue != null ? `value="{Double}${field.defaultValue}"` : '';
      const attrs = [
        'jcr:primaryType="nt:unstructured"',
        'sling:resourceType="granite/ui/components/coral/foundation/form/numberfield"',
        `name="${xmlAttr(propPath)}"`,
        label,
        desc,
        req,
        min,
        max,
        step,
        def,
      ].filter(Boolean).join('\n' + pad + '    ');
      return `${pad}<${nodeName} ${attrs}/>`;
    }

    case 'checkbox': {
      const text = field.label ? `text="${xmlAttr(field.label)}"` : `text="${xmlAttr(nodeName)}"`;
      const checked = field.defaultValue === true ? `checked="{Boolean}true"` : '';
      const attrs = [
        'jcr:primaryType="nt:unstructured"',
        'sling:resourceType="granite/ui/components/coral/foundation/form/checkbox"',
        `name="${xmlAttr(propPath)}"`,
        text,
        desc,
        'value="true"',
        'uncheckedValue="false"',
        checked,
      ].filter(Boolean).join('\n' + pad + '    ');
      return `${pad}<${nodeName} ${attrs}/>`;
    }

    case 'select': {
      const options = field.options ?? {};
      const optionsXml = Object.entries(options)
        .map(([optVal, optLabel]) => {
          return `${pad}        <${optVal} jcr:primaryType="nt:unstructured" text="${xmlAttr(optLabel)}" value="${xmlAttr(optVal)}"/>`;
        })
        .join('\n');
      return `${pad}<${nodeName} jcr:primaryType="nt:unstructured"
${pad}    sling:resourceType="granite/ui/components/coral/foundation/form/select"
${pad}    name="${xmlAttr(propPath)}"
${pad}    ${label}>
${pad}    <items jcr:primaryType="nt:unstructured">
${optionsXml}
${pad}    </items>
${pad}</${nodeName}>`;
    }

    case 'path':
    case 'link': {
      const root = field.root ? `rootPath="${xmlAttr(field.root)}"` : 'rootPath="/content"';
      const attrs = [
        'jcr:primaryType="nt:unstructured"',
        'sling:resourceType="granite/ui/components/coral/foundation/form/pathfield"',
        `name="${xmlAttr(propPath)}"`,
        label,
        desc,
        req,
        root,
      ].filter(Boolean).join('\n' + pad + '    ');
      return `${pad}<${nodeName} ${attrs}/>`;
    }

    case 'image': {
      const root = field.root ? `rootPath="${xmlAttr(field.root)}"` : 'rootPath="/content/dam"';
      const attrs = [
        'jcr:primaryType="nt:unstructured"',
        'sling:resourceType="granite/ui/components/coral/foundation/form/pathfield"',
        `name="${xmlAttr(propPath)}"`,
        label,
        desc,
        req,
        root,
      ].filter(Boolean).join('\n' + pad + '    ');
      return `${pad}<${nodeName} ${attrs}/>`;
    }

    case 'multifield': {
      const subFields = field.fields ?? {};
      const subXml = Object.entries(subFields)
        .map(([subName, subField]) => renderField(subName, subField, './' + subName, indent + 8))
        .join('\n');
      return `${pad}<${nodeName} jcr:primaryType="nt:unstructured"
${pad}    sling:resourceType="granite/ui/components/coral/foundation/form/multifield"
${pad}    composite="{Boolean}true"
${pad}    ${label}>
${pad}    <field jcr:primaryType="nt:unstructured"
${pad}        sling:resourceType="granite/ui/components/coral/foundation/container"
${pad}        name="${xmlAttr(propPath)}">
${pad}        <items jcr:primaryType="nt:unstructured">
${subXml}
${pad}        </items>
${pad}    </field>
${pad}</${nodeName}>`;
    }

    default:
      return `${pad}<${nodeName} jcr:primaryType="nt:unstructured" name="${xmlAttr(propPath)}"/>`;
  }
}
