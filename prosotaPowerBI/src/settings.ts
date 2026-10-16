import { formattingSettings } from 'powerbi-visuals-utils-formattingmodel';
class DisplaySettings extends formattingSettings.SimpleCard {
    name = 'display';
    displayName = 'Display';
    fontSize = new formattingSettings.NumUpDown({ name: 'fontSize', displayName: 'Text size', value: 12 });
    slices = [this.fontSize];
}
export class VisualFormattingSettingsModel extends formattingSettings.Model {
    display = new DisplaySettings();
    cards = [this.display];
}
