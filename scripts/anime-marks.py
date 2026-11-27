"""Convierte a ONNX los puntos de rostro anime (CFA). Es opcional: Masu funciona sin ellos.

Necesita torch y onnx. El modelo original no declara licencia: es para uso personal.
Pesos: https://huggingface.co/public-data/anime_face_landmark_detection
Uso: python scripts/anime-marks.py checkpoint_landmark_191116.pth public/models/anime_marks.onnx
"""
import sys

import torch
import torch.nn as nn


class CFA(nn.Module):
    """Cascaded Face Alignment: la arquitectura de kanosawa/anime_face_landmark_detection."""

    def __init__(self, out=25):
        super().__init__()
        self.output_channel_num = out
        conv = lambda i, o: nn.Conv2d(i, o, kernel_size=3, padding=1)
        relu = lambda: nn.ReLU(inplace=False)
        self.features = nn.Sequential(
            conv(3, 64), relu(), conv(64, 64), relu(), nn.MaxPool2d(2, 2),
            conv(64, 128), relu(), conv(128, 128), relu(), nn.MaxPool2d(2, 2),
            conv(128, 256), relu(), conv(256, 256), relu(), conv(256, 256), relu(),
        )
        self.CFM_features = nn.Sequential(conv(256, 256), relu(), conv(256, 128), relu())
        self.stages = nn.ModuleList([self.stage(128), self.stage(128 + out)])

    def stage(self, channels):
        layers = [nn.Conv2d(channels, 128, 3, padding=1), nn.ReLU(inplace=False)]
        for _ in range(4):
            layers += [nn.Conv2d(128, 128, 3, padding=1), nn.ReLU(inplace=False)]
        layers.append(nn.Conv2d(128, self.output_channel_num, 3, padding=1))
        return nn.Sequential(*layers)

    def forward(self, x):
        feature = self.CFM_features(self.features(x))
        first = self.stages[0](feature)
        return self.stages[1](torch.cat([feature, first], 1))


model = CFA()
state = torch.load(sys.argv[1], map_location='cpu', weights_only=True)['state_dict']
model.load_state_dict({k.replace('module.', ''): v for k, v in state.items()})
model.eval()
torch.onnx.export(model, torch.zeros(1, 3, 128, 128), sys.argv[2], input_names=['image'], output_names=['heatmaps'], opset_version=17, dynamo=False)
